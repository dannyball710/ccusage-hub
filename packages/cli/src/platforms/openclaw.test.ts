import type { SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installerFor, useTmpDir } from "./hook-test-utils.js";
import { isExplicitlyDisabled } from "./openclaw-cli.js";

type Run = (bin: string, args: string[], options: object) => SpawnSyncReturns<string>;

// Stubs the openclaw CLI: these tests must never shell out to a real binary.
const spawnSyncMock = vi.hoisted(() => vi.fn<Run>());
vi.mock("node:child_process", () => ({ spawnSync: spawnSyncMock }));

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("openclaw")(path);

// Registration (the real CLI call) only runs for the DEFAULT location. To reach
// it without writing to the real ~/.openclaw, point openclaw's own
// OPENCLAW_STATE_DIR at a temp dir and call install() with no arg: settingsPath
// stays undefined yet defaultDir() lands in the sandbox. The CLI is still mocked.
const stateEnv = { save: undefined as string | undefined };
beforeEach(() => {
  spawnSyncMock.mockReset();
  stateEnv.save = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = tmp();
  delete process.env.OPENCLAW_CONFIG_PATH; // must not let a real config path win
});
afterEach(() => {
  if (stateEnv.save === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = stateEnv.save;
});

// Where defaultDir() lands given OPENCLAW_STATE_DIR=tmp().
const defaultDir = (): string => join(tmp(), "hooks", "ccusage-hub-sync");

function reply(over: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> {
  return { pid: 1, output: [], stdout: "", stderr: "", status: 0, signal: null, ...over };
}

// Programs the two commands the installer may run, keyed by subcommand.
function cli(get: SpawnSyncReturns<string>, enable: SpawnSyncReturns<string> = reply({})): void {
  spawnSyncMock.mockImplementation((_bin, args) => (args[0] === "config" ? get : enable));
}

const enableCalls = (): string[][] =>
  spawnSyncMock.mock.calls.map((call) => call[1]).filter((args) => args[0] === "hooks");

describe("installOpenclawHook", () => {
  it("writes HOOK.md and handler.js, then registers the hook", () => {
    cli(reply({ stdout: "null" }));
    const dir = defaultDir();

    const message = install(); // default path -> auto-registers
    expect(message).toContain(`hook installed (${dir})`);
    expect(message).toContain("registered");

    // The scan is skipped entirely unless hooks.internal is configured, so the
    // files alone would be inert -- registration is not optional.
    expect(enableCalls()).toEqual([["hooks", "enable", "ccusage-hub-sync"]]);

    const md = readFileSync(join(dir, "HOOK.md"), "utf8");
    expect(md).toContain("name: ccusage-hub-sync");
    // An empty events array means the hook silently never registers.
    expect(md).toContain('"events":["session:compact:after","command:reset","command:stop","gateway:shutdown"]');
  });

  // .js, not .ts: no transpiler is wired into openclaw's hooks loader.
  it("ships a plain ESM handler that spawns detached and never awaits", () => {
    cli(reply({ stdout: "null" }));
    install();
    const dir = defaultDir();

    expect(existsSync(join(dir, "handler.js"))).toBe(true);
    expect(existsSync(join(dir, "handler.ts"))).toBe(false);
    const src = readFileSync(join(dir, "handler.js"), "utf8");
    expect(src).toContain("export default async (event) =>");
    expect(src).toContain("detached: true");
    expect(src).toContain(".unref()");
    expect(src).not.toContain("await spawn");
  });

  // Without this, handler.js loads only because Node >=22.7 sniffs module
  // syntax; with that detection off the import fails outright. Nothing above
  // ~/.openclaw declares a "type", and .mjs is not an accepted handler name.
  it("declares the handler as ESM so it does not depend on Node's syntax sniffing", () => {
    cli(reply({ stdout: "null" }));
    install();
    expect(JSON.parse(readFileSync(join(defaultDir(), "package.json"), "utf8"))).toEqual({
      type: "module",
    });
  });

  // The guardrail. `openclaw hooks enable` spreads {enabled: true} with no check
  // of the prior value, so auto-running it would clobber a deliberate opt-out --
  // plausibly a security decision, since these hooks run as trusted in-process code.
  it("refuses to enable when the user explicitly disabled internal hooks", () => {
    cli(reply({ stdout: "false" }));

    const message = install();
    expect(enableCalls()).toEqual([]); // the whole point: we never flip their flag
    expect(message).toContain("NOT activated");
    expect(message).toContain("hooks.internal.enabled = false");
    expect(message).toContain("openclaw hooks enable ccusage-hub-sync");
    expect(message).toContain("re-enables ALL internal hooks");
    // The files still land, so activating later is one command away.
    expect(existsSync(join(defaultDir(), "HOOK.md"))).toBe(true);
  });

  it("writes the files and explains activation when the CLI is missing", () => {
    const enoent = Object.assign(new Error("spawn openclaw ENOENT"), { code: "ENOENT" });
    cli(reply({ status: null, error: enoent }));

    const message = install();
    expect(message).toContain("openclaw CLI was not found");
    expect(message).toContain("NOT active yet");
    expect(message).toContain("openclaw hooks enable ccusage-hub-sync");
    // Never leave the user believing sync is live when it is not.
    expect(message).not.toContain("; registered");
    expect(existsSync(join(defaultDir(), "handler.js"))).toBe(true);
  });

  // openclaw's config write strips JSON5 comments and warns only on stderr; that
  // warning is the user's sole notice, so swallowing it would hide real damage.
  it("forwards the CLI's stderr even when registration succeeds", () => {
    cli(reply({ stdout: "true" }), reply({ stderr: "warning: comments were stripped from openclaw.json" }));
    const message = install();
    expect(message).toContain("registered (openclaw: warning: comments were stripped from openclaw.json)");
  });

  // Every failure exits 1 and differs only by stderr text, so the text is the
  // only useful diagnostic we can give.
  it("reports the CLI's stderr when registration fails", () => {
    cli(reply({ stdout: "null" }), reply({ status: 1, stderr: 'Hook "ccusage-hub-sync" is not eligible' }));
    const message = install();
    expect(message).toContain("registering failed");
    expect(message).toContain("is not eligible");
    expect(message).toContain("openclaw hooks enable ccusage-hub-sync");
  });

  // An explicit --settings-path means "don't touch my real environment", so the
  // real CLI call must be skipped just like the file writes are redirected --
  // otherwise the flag sandboxes the files but silently mutates the real config.
  it("skips the real CLI call entirely when a custom path is supplied", () => {
    cli(reply({ stdout: "null" }));
    const custom = join(tmp(), "custom", "hooks");

    const message = install(custom);
    // The strongest possible assertion: no openclaw process was ever spawned,
    // not even the read-only `config get` pre-check.
    expect(spawnSyncMock).not.toHaveBeenCalled();
    expect(message).toContain(`hook installed (${custom})`);
    expect(message).toContain("registration skipped for a custom path");
    expect(message).toContain("openclaw hooks enable ccusage-hub-sync");
    expect(existsSync(join(custom, "HOOK.md"))).toBe(true);
  });

  it("is idempotent and does not rewrite the files on re-run", () => {
    cli(reply({ stdout: "null" }));
    install();
    const before = statSync(join(defaultDir(), "handler.js")).mtimeMs;

    expect(install()).toContain(`hook already installed (${defaultDir()})`);
    expect(statSync(join(defaultDir(), "handler.js")).mtimeMs).toBe(before);
  });

  it("leaves another hook's directory untouched", () => {
    cli(reply({ stdout: "null" }));
    const theirs = join(tmp(), "hooks", "their-hook", "HOOK.md");
    mkdirSync(join(tmp(), "hooks", "their-hook"), { recursive: true });
    writeFileSync(theirs, "---\nname: their-hook\n---\n");
    install();
    expect(readFileSync(theirs, "utf8")).toBe("---\nname: their-hook\n---\n");
  });
});

// The exact output shape of `openclaw config get --json` could not be observed
// (openclaw is not installable here), so this errs toward respecting an opt-out:
// only a confidently not-false reading may enable.
describe("isExplicitlyDisabled", () => {
  it("treats a JSON false as an opt-out", () => {
    expect(isExplicitlyDisabled("false")).toBe(true);
    expect(isExplicitlyDisabled("  false\n")).toBe(true);
  });

  it("does not treat true, null or an unset key as an opt-out", () => {
    expect(isExplicitlyDisabled("true")).toBe(false);
    expect(isExplicitlyDisabled("null")).toBe(false);
    expect(isExplicitlyDisabled("")).toBe(false);
  });

  // If --json turns out to be unsupported and the value prints as prose, a
  // strict JSON.parse would throw and we would wrongly read it as "unset".
  it("still detects an opt-out in non-JSON output", () => {
    expect(isExplicitlyDisabled("hooks.internal.enabled = false")).toBe(true);
    expect(isExplicitlyDisabled('{ "enabled": false }')).toBe(true);
    expect(isExplicitlyDisabled("hooks.internal.enabled = true")).toBe(false);
  });
});

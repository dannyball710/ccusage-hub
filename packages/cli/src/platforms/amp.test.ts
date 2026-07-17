import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installerFor, useTmpDir } from "./hook-test-utils.js";
import { hookArgv, PER_TURN_MIN_INTERVAL_SECONDS } from "./types.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("amp")(path);
const pluginPath = (): string => join(tmp(), "plugins", "ccusage-hub-sync.ts");

describe("installAmpHook", () => {
  // Amp only scans its plugins dir at startup, so reporting a bare "installed"
  // would leave the user expecting syncs that cannot happen until a reload.
  it("writes the plugin and tells the user how to load it", () => {
    const path = pluginPath();
    const message = install(path);
    expect(message).toContain(`hook installed (${path})`);
    expect(message).toContain("plugins: reload");

    const src = readFileSync(path, "utf8");
    expect(src).toContain('amp.on("agent.end"');
    expect(src).toContain('import type { PluginAPI } from "@ampcode/plugin"');
  });

  it("spawns detached, throttled, and never awaits", () => {
    const path = pluginPath();
    install(path);
    const src = readFileSync(path, "utf8");
    expect(src).toContain("detached: true");
    expect(src).toContain("windowsHide: true");
    expect(src).toContain(".unref()");
    expect(src).not.toContain("await spawn");
    // agent.end is per-turn, so the command must carry the throttle.
    expect(src).toContain(JSON.stringify(hookArgv(PER_TURN_MIN_INTERVAL_SECONDS)));
  });

  // Handing Amp a {action: "continue"} result would make it start a follow-up
  // turn, so the handler must fall off the end with no return statement at all.
  it("returns void from the handler rather than a continue action", () => {
    const path = pluginPath();
    install(path);
    const handlerBody = readFileSync(path, "utf8").split('amp.on("agent.end", () => {')[1];
    expect(handlerBody).toBeDefined();
    // Anchored so the word inside an explanatory comment cannot satisfy it.
    expect(handlerBody).not.toMatch(/^\s*return\b/m);
  });

  it("is idempotent and does not rewrite or re-nag on re-run", () => {
    const path = pluginPath();
    install(path);
    const before = statSync(path).mtimeMs;
    const message = install(path);
    expect(message).toBe(`hook already installed (${path})`);
    expect(message).not.toContain("plugins: reload");
    expect(statSync(path).mtimeMs).toBe(before);
  });

  it("leaves an unrelated plugin in the same directory untouched", () => {
    const path = pluginPath();
    const theirs = join(tmp(), "plugins", "their-plugin.ts");
    mkdirSync(join(tmp(), "plugins"), { recursive: true });
    writeFileSync(theirs, "export default function () {}");
    install(path);
    expect(readFileSync(theirs, "utf8")).toBe("export default function () {}");
  });

  it("aborts when the path is unreadable rather than clobbering it", () => {
    const path = pluginPath();
    mkdirSync(path, { recursive: true });
    expect(() => install(path)).toThrow("cannot read");
  });
});

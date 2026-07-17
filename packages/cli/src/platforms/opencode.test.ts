import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installerFor, useTmpDir } from "./hook-test-utils.js";
import { hookArgv, PER_TURN_MIN_INTERVAL_SECONDS } from "./types.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("opencode")(path);
const pluginPath = (): string => join(tmp(), "plugin", "ccusage-hub-sync.ts");

describe("installOpencodeHook", () => {
  it("writes the plugin file (and parent dirs) on fresh install", () => {
    const path = pluginPath();
    expect(install(path)).toBe(`hook installed (${path})`);

    const src = readFileSync(path, "utf8");
    expect(src).toContain('import { spawn } from "node:child_process"');
    // OpenCode calls every top-level export as a plugin factory, so exporting a
    // non-callable would break the whole session.
    expect(src).toContain("export const CcusageHubSync = createPlugin");
  });

  // session.idle is deprecated in favour of session.status; handling only one of
  // them would break either today or at the deprecation.
  it("fires on both the deprecated session.idle and its session.status successor", () => {
    const path = pluginPath();
    install(path);
    const src = readFileSync(path, "utf8");
    expect(src).toContain('event.type === "session.idle"');
    expect(src).toContain('event.type === "session.status"');
    expect(src).toContain('event.properties?.status?.type === "idle"');
  });

  // The sync must never be awaited or the agent's own exit would block on it.
  it("spawns detached, throttled, and never awaits", () => {
    const path = pluginPath();
    install(path);
    const src = readFileSync(path, "utf8");
    expect(src).toContain("detached: true");
    expect(src).toContain("windowsHide: true");
    expect(src).toContain(".unref()");
    expect(src).not.toContain("await spawn");
    // session.idle is per-turn, so the command must carry the throttle.
    expect(src).toContain(JSON.stringify(hookArgv(PER_TURN_MIN_INTERVAL_SECONDS)));
  });

  it("is idempotent and does not rewrite the file on re-run", () => {
    const path = pluginPath();
    install(path);
    const before = statSync(path).mtimeMs;
    expect(install(path)).toBe(`hook already installed (${path})`);
    expect(statSync(path).mtimeMs).toBe(before);
  });

  it("leaves an unrelated plugin in the same directory untouched", () => {
    const path = pluginPath();
    const theirs = join(tmp(), "plugin", "their-plugin.ts");
    mkdirSync(join(tmp(), "plugin"), { recursive: true });
    writeFileSync(theirs, "export const Theirs = async () => ({})");
    install(path);
    expect(readFileSync(theirs, "utf8")).toBe("export const Theirs = async () => ({})");
  });

  it("aborts when the path is unreadable rather than clobbering it", () => {
    const path = pluginPath();
    mkdirSync(path, { recursive: true }); // a directory here makes the read fail with EISDIR
    expect(() => install(path)).toThrow("cannot read");
  });
});

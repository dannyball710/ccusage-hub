import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installerFor, useTmpDir } from "./hook-test-utils.js";
import { hookArgv, PER_TURN_MIN_INTERVAL_SECONDS } from "./types.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("kilo")(path);
const pluginPath = (): string => join(tmp(), "plugin", "ccusage-hub-sync.ts");

describe("installKiloHook", () => {
  // Kilo forks OpenCode's loader but takes the default export as a descriptor
  // object, so the export shape is the one thing that must differ.
  it("writes a plugin whose default export is Kilo's descriptor shape", () => {
    const path = pluginPath();
    expect(install(path)).toBe(`hook installed (${path})`);

    const src = readFileSync(path, "utf8");
    expect(src).toContain('export default { id: "ccusage-hub-sync", server: createPlugin }');
    expect(src).not.toContain("export const CcusageHubSync");
  });

  it("shares OpenCode's idle handling and detached spawn", () => {
    const path = pluginPath();
    install(path);
    const src = readFileSync(path, "utf8");
    expect(src).toContain('event.type === "session.idle"');
    expect(src).toContain('event.type === "session.status"');
    expect(src).toContain("detached: true");
    expect(src).toContain(".unref()");
    expect(src).not.toContain("await spawn");
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
    writeFileSync(theirs, "export default { id: 'theirs' }");
    install(path);
    expect(readFileSync(theirs, "utf8")).toBe("export default { id: 'theirs' }");
  });

  it("aborts when the path is unreadable rather than clobbering it", () => {
    const path = pluginPath();
    mkdirSync(path, { recursive: true });
    expect(() => install(path)).toThrow("cannot read");
  });
});

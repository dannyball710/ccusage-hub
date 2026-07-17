import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installerFor, useTmpDir } from "./hook-test-utils.js";
import { hookArgv } from "./types.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("pi")(path);
const extPath = (): string => join(tmp(), "extensions", "ccusage-hub-sync.ts");

describe("installPiHook", () => {
  it("writes the extension file (and parent dirs) on fresh install", () => {
    const path = extPath();
    expect(install(path)).toBe(`hook installed (${path})`);

    const src = readFileSync(path, "utf8");
    expect(src).toContain('pi.on("session_shutdown"');
    expect(src).toContain("export default function");
    // import type erases at runtime, so the extension needs no real dependency
    // on the pi package -- that is what makes a single-file drop work.
    expect(src).toContain('import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"');
  });

  // pi is the only platform here with a true once-per-session event, so
  // throttling it would drop real syncs rather than save work.
  it("uses the unthrottled command because session_shutdown fires once", () => {
    const path = extPath();
    install(path);
    const src = readFileSync(path, "utf8");
    expect(src).toContain(JSON.stringify(hookArgv()));
    expect(src).not.toContain("--min-interval");
  });

  // session_shutdown is awaited before process.exit() with NO timeout: awaiting
  // the sync here would hang pi's exit for the length of a usage scan.
  it("spawns detached and never awaits the sync", () => {
    const path = extPath();
    install(path);
    const src = readFileSync(path, "utf8");
    expect(src).toContain("detached: true");
    expect(src).toContain("windowsHide: true");
    expect(src).toContain(".unref()");
    expect(src).not.toContain("await spawn");
  });

  it("is idempotent and does not rewrite the file on re-run", () => {
    const path = extPath();
    install(path);
    const before = statSync(path).mtimeMs;
    expect(install(path)).toBe(`hook already installed (${path})`);
    expect(statSync(path).mtimeMs).toBe(before);
  });

  it("leaves an unrelated extension in the same directory untouched", () => {
    const path = extPath();
    const theirs = join(tmp(), "extensions", "their-ext.ts");
    mkdirSync(join(tmp(), "extensions"), { recursive: true });
    writeFileSync(theirs, "export default function () {}");
    install(path);
    expect(readFileSync(theirs, "utf8")).toBe("export default function () {}");
  });

  it("aborts when the path is unreadable rather than clobbering it", () => {
    const path = extPath();
    mkdirSync(path, { recursive: true });
    expect(() => install(path)).toThrow("cannot read");
  });
});

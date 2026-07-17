import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countOccurrences, installerFor, useTmpDir } from "./hook-test-utils.js";
import { HOOK_COMMAND } from "./types.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("goose")(path);

describe("installGooseHook", () => {
  // Goose reads hooks from an Open Plugins plugin directory that belongs to us,
  // so this is a whole-file write rather than a merge into a user config.
  it("creates the plugin hooks file (and parent dirs) on fresh install", () => {
    const path = join(tmp(), "plugins", "ccusage-hub", "hooks", "hooks.json");
    expect(install(path)).toBe(`hook installed (${path})`);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      hooks: { SessionEnd: [{ hooks: [{ type: "command", command: HOOK_COMMAND }] }] },
    });
  });

  it("is idempotent on re-run", () => {
    const path = join(tmp(), "hooks.json");
    install(path);
    expect(install(path)).toBe(`hook already installed (${path})`);
    expect(countOccurrences(readFileSync(path, "utf8"), HOOK_COMMAND)).toBe(1);
  });

  // We own this file, so a stale or hand-edited version is ours to replace --
  // unlike the user-owned configs, malformed content is not a reason to abort.
  it("rewrites a file that does not carry our command", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(path, "{ stale garbage");
    expect(install(path)).toBe(`hook installed (${path})`);
    expect(JSON.parse(readFileSync(path, "utf8")).hooks.SessionEnd).toHaveLength(1);
  });

  // A read failing for any reason other than "not there yet" means something
  // unexpected occupies the path; clobbering it blind would be wrong.
  it("aborts when the path is unreadable rather than clobbering it", () => {
    const path = join(tmp(), "hooks.json");
    mkdirSync(path); // a directory here makes readFileSync fail with EISDIR
    expect(() => install(path)).toThrow("cannot read");
    expect(() => install(path)).toThrow("refusing to overwrite");
  });
});

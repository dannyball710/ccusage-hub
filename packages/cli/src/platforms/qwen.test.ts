import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOM, countOccurrences, installerFor, useTmpDir } from "./hook-test-utils.js";
import { HOOK_COMMAND } from "./types.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("qwen")(path);

describe("installQwenHook", () => {
  it("creates settings.json (and parent dirs) on fresh install", () => {
    const path = join(tmp(), "nested", "settings.json");
    expect(install(path)).toBe(`hook installed (${path})`);
    expect(existsSync(path)).toBe(true);
  });

  // On SessionEnd qwen treats `matcher` as a regex against the exit reason, so
  // omitting it is what makes the hook fire for every session end.
  it("omits matcher so every session end matches", () => {
    const path = join(tmp(), "settings.json");
    install(path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      hooks: { SessionEnd: [{ hooks: [{ type: "command", command: HOOK_COMMAND }] }] },
    });
  });

  it("is idempotent on re-run", () => {
    const path = join(tmp(), "settings.json");
    install(path);
    expect(install(path)).toBe(`hook already installed (${path})`);
    expect(countOccurrences(readFileSync(path, "utf8"), HOOK_COMMAND)).toBe(1);
  });

  it("preserves unrelated user settings", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(path, JSON.stringify({ theme: "dark", hooks: { PreToolUse: [] } }));
    install(path);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.theme).toBe("dark");
    expect(parsed.hooks.PreToolUse).toEqual([]);
  });

  // disableAllHooks silences our hook, but it is the user's setting to own:
  // install anyway rather than fail.
  it("installs even when disableAllHooks is set", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(path, JSON.stringify({ disableAllHooks: true }));
    expect(install(path)).toContain(`hook installed (${path}`);
    expect(JSON.parse(readFileSync(path, "utf8")).disableAllHooks).toBe(true);
  });

  it("handles a BOM-prefixed settings file", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(path, BOM + JSON.stringify({ hooks: { SessionEnd: [] } }));
    expect(install(path)).toContain(`hook installed (${path}`);
    expect(countOccurrences(readFileSync(path, "utf8"), HOOK_COMMAND)).toBe(1);
  });

  it("throws on malformed JSON without overwriting", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(path, "{not json");
    expect(() => install(path)).toThrow("is not valid JSON");
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });

  it("throws when hooks.SessionEnd has the wrong type", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(path, JSON.stringify({ hooks: { SessionEnd: {} } }));
    expect(() => install(path)).toThrow('"hooks.SessionEnd" is not an array');
  });
});

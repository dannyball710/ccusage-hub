import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOM, countOccurrences, installerFor, useTmpDir } from "./hook-test-utils.js";
import { HOOK_COMMAND } from "./types.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("claude")(path);

describe("installClaudeHook", () => {
  it("creates settings.json (and parent dirs) on fresh install", () => {
    const path = join(tmp(), "nested", "settings.json");
    expect(install(path)).toBe(`hook installed (${path})`);
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain('"SessionEnd"');
    expect(text).toContain(HOOK_COMMAND);
  });

  // Claude matches SessionEnd entries against `matcher`; "*" catches every end.
  it("writes the nested matcher shape Claude expects", () => {
    const path = join(tmp(), "settings.json");
    install(path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      hooks: { SessionEnd: [{ matcher: "*", hooks: [{ type: "command", command: HOOK_COMMAND }] }] },
    });
  });

  // Re-running init must not stack duplicate hook entries.
  it("is idempotent on re-run", () => {
    const path = join(tmp(), "settings.json");
    install(path);
    expect(install(path)).toBe(`hook already installed (${path})`);
    expect(countOccurrences(readFileSync(path, "utf8"), HOOK_COMMAND)).toBe(1);
  });

  it("preserves existing unrelated hooks and appends ours after them", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        hooks: { SessionEnd: [{ matcher: "*", hooks: [{ type: "command", command: "echo hi" }] }] },
        otherSetting: true,
      }),
    );
    install(path);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("echo hi");
    expect(text).toContain('"otherSetting"');
    expect(countOccurrences(text, HOOK_COMMAND)).toBe(1);
    expect(text.indexOf("echo hi")).toBeLessThan(text.indexOf(HOOK_COMMAND));
  });

  // Windows editors add a UTF-8 BOM; JSON.parse would reject it un-stripped.
  it("handles a BOM-prefixed settings file", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(path, BOM + JSON.stringify({ hooks: { SessionEnd: [] } }));
    expect(install(path)).toContain(`hook installed (${path}`);
    expect(countOccurrences(readFileSync(path, "utf8"), HOOK_COMMAND)).toBe(1);
  });

  // Never clobber a user's real settings: any unparseable file must abort.
  it("throws on malformed JSON without overwriting", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(path, "{not json");
    expect(() => install(path)).toThrow("is not valid JSON");
    expect(() => install(path)).toThrow("refusing to overwrite");
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });

  it("throws when the file is not a JSON object", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(path, "[1, 2]");
    expect(() => install(path)).toThrow("is not a JSON object");
  });

  it("throws when hooks has the wrong type", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(path, JSON.stringify({ hooks: 5 }));
    expect(() => install(path)).toThrow('"hooks" is not an object');
  });

  it("throws when hooks.SessionEnd has the wrong type", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(path, JSON.stringify({ hooks: { SessionEnd: {} } }));
    expect(() => install(path)).toThrow('"hooks.SessionEnd" is not an array');
  });
});

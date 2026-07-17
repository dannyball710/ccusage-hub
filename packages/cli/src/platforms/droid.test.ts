import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOM, countOccurrences, installerFor, useTmpDir } from "./hook-test-utils.js";
import { HOOK_COMMAND } from "./types.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("droid")(path);

describe("installDroidHook", () => {
  it("creates hooks.json (and parent dirs) on fresh install", () => {
    const path = join(tmp(), "nested", "hooks.json");
    expect(install(path)).toBe(`hook installed (${path})`);
    expect(existsSync(path)).toBe(true);
  });

  // SessionEnd is a non-matcher event, and Droid's hooks.json carries no
  // version field -- either extra key would be wrong.
  it("writes no matcher and no version field", () => {
    const path = join(tmp(), "hooks.json");
    install(path);
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

  it("preserves existing unrelated hook events", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(
      path,
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }] } }),
    );
    install(path);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.hooks.Stop[0].hooks[0].command).toBe("echo hi");
    expect(parsed.hooks.SessionEnd).toHaveLength(1);
  });

  it("handles a BOM-prefixed hooks file", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(path, BOM + JSON.stringify({ hooks: {} }));
    expect(install(path)).toContain(`hook installed (${path}`);
    expect(countOccurrences(readFileSync(path, "utf8"), HOOK_COMMAND)).toBe(1);
  });

  it("throws on malformed JSON without overwriting", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(path, "{not json");
    expect(() => install(path)).toThrow("is not valid JSON");
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });

  it("throws when hooks has the wrong type", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(path, JSON.stringify({ hooks: 5 }));
    expect(() => install(path)).toThrow('"hooks" is not an object');
  });
});

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOM, countOccurrences, installerFor, useTmpDir } from "./hook-test-utils.js";
import { HOOK_COMMAND } from "./types.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("copilot")(path);

describe("installCopilotHook", () => {
  it("creates the hooks file (and parent dirs) on fresh install", () => {
    const path = join(tmp(), "nested", "notification-hooks.json");
    expect(install(path)).toBe(`hook installed (${path})`);
    expect(existsSync(path)).toBe(true);
  });

  // Copilot's schema is flat and lowercase, unlike Claude's nested SessionEnd,
  // and it requires an explicit version.
  it("writes the flat versioned shape with both shell commands", () => {
    const path = join(tmp(), "hooks.json");
    install(path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      version: 1,
      hooks: {
        sessionEnd: [
          {
            type: "command",
            bash: HOOK_COMMAND,
            powershell: HOOK_COMMAND,
            timeoutSec: 30,
          },
        ],
      },
    });
  });

  // The Claude-shaped predicate looks for a nested `hooks` array and would
  // never match this entry, so a re-run would silently duplicate it.
  it("is idempotent on re-run", () => {
    const path = join(tmp(), "hooks.json");
    install(path);
    expect(install(path)).toBe(`hook already installed (${path})`);
    expect(countOccurrences(readFileSync(path, "utf8"), HOOK_COMMAND)).toBe(2); // bash + powershell
  });

  it("preserves existing unrelated hooks and version", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        hooks: { sessionStart: [{ type: "command", bash: "echo hi" }] },
      }),
    );
    install(path);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.hooks.sessionStart[0].bash).toBe("echo hi");
    expect(parsed.hooks.sessionEnd).toHaveLength(1);
    expect(parsed.version).toBe(1);
  });

  // An unknown version is a schema we have not seen; appending to it could
  // produce a file Copilot rejects wholesale.
  it("aborts on an unexpected version rather than rewriting it", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(path, JSON.stringify({ version: 2, hooks: {} }));
    expect(() => install(path)).toThrow('"version" is 2, expected 1');
    expect(() => install(path)).toThrow("refusing to overwrite");
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(2);
  });

  it("handles a BOM-prefixed hooks file", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(path, BOM + JSON.stringify({ version: 1, hooks: {} }));
    expect(install(path)).toContain(`hook installed (${path}`);
  });

  it("throws on malformed JSON without overwriting", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(path, "{not json");
    expect(() => install(path)).toThrow("is not valid JSON");
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });
});

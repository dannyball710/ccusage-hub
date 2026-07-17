import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BOM, countOccurrences, installerFor, useTmpDir } from "./hook-test-utils.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("gemini")(path);

function sessionEnd(path: string): unknown[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
  const hooks = "hooks" in parsed ? parsed.hooks : undefined;
  if (typeof hooks !== "object" || hooks === null) throw new Error("no hooks");
  const events = "SessionEnd" in hooks ? hooks.SessionEnd : undefined;
  if (!Array.isArray(events)) throw new Error("no SessionEnd array");
  return events;
}

describe("installGeminiHook", () => {
  it("creates settings.json (and parent dirs) on fresh install", () => {
    const path = join(tmp(), "nested", "settings.json");
    expect(install(path)).toBe(`hook installed (${path})`);
    expect(existsSync(path)).toBe(true);
  });

  // gemini identifies handlers by `name`, unlike every other JSON platform here.
  it("writes a named handler under SessionEnd", () => {
    const path = join(tmp(), "settings.json");
    install(path);
    const entries = sessionEnd(path);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      hooks: [
        {
          name: "ccusage-hub-sync",
          type: "command",
          command: expect.stringContaining("ccusage-hub"),
        },
      ],
    });
  });

  // For lifecycle events gemini compares `matcher` to `reason` as an exact
  // string, so any matcher would drop the clear/logout/prompt_input_exit
  // sessions. Absent means "match all" -- this must stay absent.
  it("omits matcher so every session-end reason fires", () => {
    const path = join(tmp(), "settings.json");
    install(path);
    const entry = sessionEnd(path)[0];
    expect(entry).not.toHaveProperty("matcher");
  });

  // gemini awaits SessionEnd before exiting (despite its "best effort" docs) and
  // kills the tree on timeout, so the command must hand back control immediately.
  it("installs a command that detaches", () => {
    const path = join(tmp(), "settings.json");
    install(path);
    const text = readFileSync(path, "utf8");
    if (process.platform === "win32") {
      // gemini runs hooks through PowerShell on Windows, so no cmd wrapper -- and
      // Start-Process gives the child its own console so a tree-kill misses it.
      expect(text).toContain("Start-Process");
      expect(text).not.toContain("powershell -NoProfile"); // no wrapper, unlike codex
    } else {
      // gemini uses a hardcoded bash -c on POSIX.
      expect(text).toContain("nohup");
      expect(text).toContain(">/dev/null 2>&1 &");
    }
  });

  // SessionEnd is per-session so a throttle is not strictly needed, but we keep
  // it for uniformity with the per-turn platforms; it is harmless here.
  it("throttles for uniformity", () => {
    const path = join(tmp(), "settings.json");
    install(path);
    expect(readFileSync(path, "utf8")).toContain("min-interval");
  });

  it("is idempotent on re-run", () => {
    const path = join(tmp(), "settings.json");
    install(path);
    expect(install(path)).toContain(`hook already installed (${path}`);
    expect(sessionEnd(path)).toHaveLength(1);
  });

  it("preserves unrelated settings and existing hooks", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        theme: "dark",
        hooks: { SessionEnd: [{ hooks: [{ name: "other", type: "command", command: "echo hi" }] }] },
      }),
    );
    install(path);
    const text = readFileSync(path, "utf8");
    expect(text).toContain('"theme"');
    expect(text).toContain("echo hi");
    expect(sessionEnd(path)).toHaveLength(2);
  });

  it("handles a BOM-prefixed settings file", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(path, BOM + JSON.stringify({ hooks: { SessionEnd: [] } }));
    expect(install(path)).toContain("hook installed");
    expect(countOccurrences(readFileSync(path, "utf8"), '"ccusage-hub-sync"')).toBe(1);
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

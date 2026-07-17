import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EDITOR_IDS, getPlatform, HOOK_COMMAND, PLATFORMS } from "./platforms.js";

const BOM = String.fromCharCode(0xfeff);

function claudeInstallHook(): (settingsPath?: string) => string {
  const claude = getPlatform("claude");
  if (!claude || !claude.installHook) throw new Error("claude platform must have installHook");
  return claude.installHook;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), "ccusage-hub-platforms-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("platform registry", () => {
  it("derives EDITOR_IDS from the registry plus none", () => {
    expect(EDITOR_IDS).toEqual([...PLATFORMS.map((p) => p.id), "none"]);
    expect(EDITOR_IDS).toContain("claude");
    expect(EDITOR_IDS).toContain("none");
  });

  it("resolves platforms by id", () => {
    expect(getPlatform("claude")?.label).toBe("Claude Code");
    expect(getPlatform("codex")?.label).toBe("Codex CLI");
    expect(getPlatform("bogus")).toBeUndefined();
  });

  // Only claude has a hook mechanism today; init must fall back to the
  // "no hook installed" note for the others.
  it("only claude provides installHook", () => {
    for (const p of PLATFORMS) {
      if (p.id === "claude") expect(p.installHook).toBeTypeOf("function");
      else expect(p.installHook).toBeUndefined();
    }
  });

  it("hook command invokes ccusage-hub in quiet mode", () => {
    expect(HOOK_COMMAND).toContain("ccusage-hub");
    expect(HOOK_COMMAND).toContain("--quiet");
  });
});

describe("installClaudeHook", () => {
  it("creates settings.json (and parent dirs) on fresh install", () => {
    const path = join(tmpDir, "nested", "settings.json");
    const msg = claudeInstallHook()(path);
    expect(msg).toBe(`hook installed (${path})`);
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain('"SessionEnd"');
    expect(text).toContain(HOOK_COMMAND);
  });

  // Re-running init must not stack duplicate hook entries.
  it("is idempotent on re-run", () => {
    const path = join(tmpDir, "settings.json");
    claudeInstallHook()(path);
    const msg = claudeInstallHook()(path);
    expect(msg).toBe(`hook already installed (${path})`);
    expect(countOccurrences(readFileSync(path, "utf8"), HOOK_COMMAND)).toBe(1);
  });

  it("preserves existing unrelated hooks and appends ours after them", () => {
    const path = join(tmpDir, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        hooks: { SessionEnd: [{ matcher: "*", hooks: [{ type: "command", command: "echo hi" }] }] },
        otherSetting: true,
      }),
    );
    claudeInstallHook()(path);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("echo hi");
    expect(text).toContain('"otherSetting"');
    expect(countOccurrences(text, HOOK_COMMAND)).toBe(1);
    expect(text.indexOf("echo hi")).toBeLessThan(text.indexOf(HOOK_COMMAND));
  });

  // Windows editors add a UTF-8 BOM; JSON.parse would reject it un-stripped.
  it("handles a BOM-prefixed settings file", () => {
    const path = join(tmpDir, "settings.json");
    writeFileSync(path, BOM + JSON.stringify({ hooks: { SessionEnd: [] } }));
    const msg = claudeInstallHook()(path);
    expect(msg).toBe(`hook installed (${path})`);
    expect(countOccurrences(readFileSync(path, "utf8"), HOOK_COMMAND)).toBe(1);
  });

  // Never clobber a user's real settings: any unparseable file must abort.
  it("throws on malformed JSON without overwriting", () => {
    const path = join(tmpDir, "settings.json");
    writeFileSync(path, "{not json");
    expect(() => claudeInstallHook()(path)).toThrow("is not valid JSON");
    expect(() => claudeInstallHook()(path)).toThrow("refusing to overwrite");
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });

  it("throws when the file is not a JSON object", () => {
    const path = join(tmpDir, "settings.json");
    writeFileSync(path, "[1, 2]");
    expect(() => claudeInstallHook()(path)).toThrow("is not a JSON object");
  });

  it("throws when hooks has the wrong type", () => {
    const path = join(tmpDir, "settings.json");
    writeFileSync(path, JSON.stringify({ hooks: 5 }));
    expect(() => claudeInstallHook()(path)).toThrow('"hooks" is not an object');
  });

  it("throws when hooks.SessionEnd has the wrong type", () => {
    const path = join(tmpDir, "settings.json");
    writeFileSync(path, JSON.stringify({ hooks: { SessionEnd: {} } }));
    expect(() => claudeInstallHook()(path)).toThrow('"hooks.SessionEnd" is not an array');
  });
});

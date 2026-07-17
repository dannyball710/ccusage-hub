import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countOccurrences, installerFor, useTmpDir } from "./hook-test-utils.js";
import { HOOK_COMMAND } from "./types.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("kimi")(path);

interface HookTable {
  [key: string]: unknown;
}

function isTable(v: unknown): v is HookTable {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readHooks(path: string): HookTable[] {
  const hooks: unknown = parse(readFileSync(path, "utf8")).hooks;
  if (!Array.isArray(hooks)) throw new Error("expected an array of [[hooks]] tables");
  const tables = hooks.filter(isTable);
  if (tables.length !== hooks.length) throw new Error("every [[hooks]] entry must be a table");
  return tables;
}

function hookAt(hooks: HookTable[], index: number): HookTable {
  const hook = hooks[index];
  if (hook === undefined) throw new Error(`no [[hooks]] entry at index ${index}`);
  return hook;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.KIMI_CODE_HOME;
});

describe("installKimiHook", () => {
  it("creates config.toml (and parent dirs) on fresh install", () => {
    const path = join(tmp(), "nested", "config.toml");
    expect(install(path)).toBe(`hook installed (${path})`);
    expect(countOccurrences(readFileSync(path, "utf8"), HOOK_COMMAND)).toBe(1);
  });

  // [[hooks]] accepts EXACTLY these four fields -- any extra key makes kimi fail
  // to load the user's entire config, not just skip our hook.
  it("emits exactly the four supported fields", () => {
    const path = join(tmp(), "config.toml");
    install(path);
    const hooks = readHooks(path);
    expect(hooks).toHaveLength(1);
    expect(hookAt(hooks, 0)).toEqual({
      event: "SessionEnd",
      matcher: "exit",
      command: HOOK_COMMAND,
      timeout: 30,
    });
    expect(Object.keys(hookAt(hooks, 0))).toHaveLength(4);
  });

  it("is idempotent on re-run", () => {
    const path = join(tmp(), "config.toml");
    install(path);
    expect(install(path)).toBe(`hook already installed (${path})`);
    expect(readHooks(path)).toHaveLength(1);
  });

  it("preserves unrelated config and existing hooks", () => {
    const path = join(tmp(), "config.toml");
    writeFileSync(
      path,
      'model = "k2"\n\n[[hooks]]\nevent = "SessionStart"\nmatcher = "startup"\n' +
        'command = "echo hi"\ntimeout = 5\n',
    );
    install(path);
    const parsed = parse(readFileSync(path, "utf8"));
    expect(parsed.model).toBe("k2");
    const hooks = readHooks(path);
    expect(hooks).toHaveLength(2);
    expect(hookAt(hooks, 0).command).toBe("echo hi");
  });

  // The reason we append instead of round-tripping: smol-toml has no CST, so
  // re-serializing the parsed document would silently drop the user's comments.
  // Losing a comment is damage even though the file still parses.
  it("preserves comments and formatting byte-for-byte before the appended block", () => {
    const path = join(tmp(), "config.toml");
    const original =
      "# Kimi config -- hand-tuned, do not lose this\n" +
      'model = "k2" # my preferred model\n' +
      "\n" +
      "# temperature stays low on purpose\n" +
      "temperature = 0.2\n";
    writeFileSync(path, original);
    install(path);
    const after = readFileSync(path, "utf8");
    // Every original byte survives untouched at the head of the file.
    expect(after.startsWith(original)).toBe(true);
    expect(after).toContain("# Kimi config -- hand-tuned, do not lose this");
    expect(after).toContain("# my preferred model");
    expect(after).toContain("# temperature stays low on purpose");
    // And our entry parses out correctly on top of it.
    const parsed = parse(after);
    expect(parsed.temperature).toBe(0.2);
    expect(readHooks(path)).toHaveLength(1);
  });

  // A file with no trailing newline must still yield valid TOML after the append.
  it("appends valid TOML when the original has no trailing newline", () => {
    const path = join(tmp(), "config.toml");
    writeFileSync(path, 'model = "k2"'); // no newline
    install(path);
    const after = readFileSync(path, "utf8");
    expect(after.startsWith('model = "k2"')).toBe(true);
    expect(() => parse(after)).not.toThrow();
    expect(readHooks(path)).toHaveLength(1);
  });

  it("throws on malformed TOML without overwriting", () => {
    const path = join(tmp(), "config.toml");
    writeFileSync(path, "this is [not valid");
    expect(() => install(path)).toThrow("is not valid TOML");
    expect(() => install(path)).toThrow("refusing to overwrite");
    expect(readFileSync(path, "utf8")).toBe("this is [not valid");
  });

  it("throws when hooks is not an array of tables", () => {
    const path = join(tmp(), "config.toml");
    writeFileSync(path, 'hooks = "nope"\n');
    expect(() => install(path)).toThrow('"hooks" is not an array of tables');
  });
});

describe("kimi config home selection", () => {
  it("honours KIMI_CODE_HOME", () => {
    process.env.KIMI_CODE_HOME = join(tmp(), "custom");
    const msg = install();
    expect(msg).toBe(`hook installed (${join(tmp(), "custom", "config.toml")})`);
  });

  // kimi-code auto-migrates ~/.kimi on install, so a hook written to the legacy
  // path can be silently superseded. Prefer the new home whenever it exists.
  it("prefers ~/.kimi-code even when the legacy ~/.kimi exists", () => {
    vi.spyOn(os, "homedir").mockReturnValue(tmp());
    mkdirSync(join(tmp(), ".kimi-code"));
    mkdirSync(join(tmp(), ".kimi"));
    const msg = install();
    expect(msg).toBe(`hook installed (${join(tmp(), ".kimi-code", "config.toml")})`);
  });

  it("falls back to the legacy ~/.kimi and says so when ~/.kimi-code is absent", () => {
    vi.spyOn(os, "homedir").mockReturnValue(tmp());
    mkdirSync(join(tmp(), ".kimi"));
    const msg = install();
    expect(msg).toContain(join(tmp(), ".kimi", "config.toml"));
    expect(msg).toContain("legacy");
  });

  it("uses ~/.kimi-code when neither home exists yet", () => {
    vi.spyOn(os, "homedir").mockReturnValue(tmp());
    const msg = install();
    expect(msg).toBe(`hook installed (${join(tmp(), ".kimi-code", "config.toml")})`);
  });
});

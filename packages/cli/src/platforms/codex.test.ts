import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BOM, countOccurrences, installerFor, useTmpDir } from "./hook-test-utils.js";
import { PER_TURN_MIN_INTERVAL_SECONDS } from "./types.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("codex")(path);

interface StopHandler {
  type?: unknown;
  command?: unknown;
  commandWindows?: unknown;
  timeout?: unknown;
}

function stopHandlers(path: string): StopHandler[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
  const hooks = "hooks" in parsed ? parsed.hooks : undefined;
  if (typeof hooks !== "object" || hooks === null) throw new Error("no hooks");
  const stop = "Stop" in hooks ? hooks.Stop : undefined;
  if (!Array.isArray(stop)) throw new Error("no Stop array");
  return stop.flatMap((group: unknown) => {
    if (typeof group !== "object" || group === null || !("hooks" in group)) return [];
    return Array.isArray(group.hooks) ? group.hooks : [];
  });
}

afterEach(() => {
  delete process.env.CODEX_HOME;
});

describe("installCodexHook", () => {
  it("creates hooks.json (and parent dirs) on fresh install", () => {
    const path = join(tmp(), "nested", "hooks.json");
    expect(install(path)).toBe(`hook installed (${path})`);
    expect(existsSync(path)).toBe(true);
  });

  it("honours CODEX_HOME for the default path", () => {
    process.env.CODEX_HOME = join(tmp(), "codexhome");
    expect(install()).toBe(`hook installed (${join(tmp(), "codexhome", "hooks.json")})`);
  });

  // Codex runs Stop hooks synchronously and blocks the turn. An omitted timeout
  // defaults to 600s, so a hung command would wedge a turn for ten minutes.
  it("always sets a short explicit timeout", () => {
    const path = join(tmp(), "hooks.json");
    install(path);
    const handlers = stopHandlers(path);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.timeout).toBe(10);
  });

  // Both forms ship regardless of install platform so a shared home works from
  // either OS: POSIX runs `command` via $SHELL -lc, Windows `commandWindows`
  // via %COMSPEC% /C (cmd). `start /b` was measured to leave the grandchild
  // holding codex's pipe (turn stalls); the PowerShell Start-Process form
  // detaches cleanly, so that is what the Windows form uses.
  it("emits detaching commands for both POSIX and Windows", () => {
    const path = join(tmp(), "hooks.json");
    install(path);
    const handler = stopHandlers(path)[0];
    expect(handler?.command).toContain("nohup ");
    expect(handler?.command).toContain(">/dev/null 2>&1 &");
    expect(handler?.commandWindows).toContain("powershell -NoProfile -Command Start-Process");
    expect(handler?.commandWindows).toContain("-WindowStyle Hidden");
    // cmd /C strips a nested double-quoted argument, so the PowerShell statement
    // must carry none -- only single quotes around the argv elements.
    expect(handler?.commandWindows).not.toContain('"');
  });

  // Stop is per-turn, so without a throttle this would scan on every reply.
  it("throttles both commands because Stop is per-turn", () => {
    const path = join(tmp(), "hooks.json");
    install(path);
    const handler = stopHandlers(path)[0];
    const seconds = String(PER_TURN_MIN_INTERVAL_SECONDS);
    // POSIX carries it as a shell string; the Windows argv form as two tokens.
    expect(handler?.command).toContain(`--min-interval ${seconds}`);
    expect(handler?.commandWindows).toContain(`'--min-interval','${seconds}'`);
  });

  // Codex flags non-JSON stdout as "invalid stop hook JSON output" in the user's
  // hook panel. POSIX redirects the child's output away; the Windows form uses
  // Start-Process, which gives the child its own hidden console so nothing ever
  // reaches codex's captured stdout.
  it("keeps the child's output away from codex's stdout", () => {
    const path = join(tmp(), "hooks.json");
    install(path);
    const handler = stopHandlers(path)[0];
    expect(handler?.command).toContain(">/dev/null 2>&1");
    expect(handler?.commandWindows).toContain("-WindowStyle Hidden");
  });

  it("is idempotent on re-run", () => {
    const path = join(tmp(), "hooks.json");
    install(path);
    expect(install(path)).toContain(`hook already installed (${path}`);
    expect(stopHandlers(path)).toHaveLength(1);
  });

  it("preserves existing unrelated hook events", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(
      path,
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
      }),
    );
    install(path);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("echo hi");
    expect(text).toContain('"SessionStart"');
    expect(stopHandlers(path)).toHaveLength(1);
  });

  it("handles a BOM-prefixed hooks file", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(path, BOM + JSON.stringify({ hooks: {} }));
    expect(install(path)).toContain("hook installed");
    // once in `command`, once in `commandWindows`
    expect(countOccurrences(readFileSync(path, "utf8"), "ccusage-hub@latest")).toBe(2);
  });

  it("throws on malformed JSON without overwriting", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(path, "{not json");
    expect(() => install(path)).toThrow("is not valid JSON");
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });

  it("throws when hooks.Stop has the wrong type", () => {
    const path = join(tmp(), "hooks.json");
    writeFileSync(path, JSON.stringify({ hooks: { Stop: {} } }));
    expect(() => install(path)).toThrow('"hooks.Stop" is not an array');
  });
});

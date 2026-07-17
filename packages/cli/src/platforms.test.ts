import { describe, expect, it } from "vitest";
import { entryRunsCcusageHub } from "./platforms/json-merge.js";
import { EDITOR_IDS, getPlatform, HOOK_COMMAND, PLATFORMS } from "./platforms/index.js";
import { hookCommand, PER_TURN_MIN_INTERVAL_SECONDS } from "./platforms/types.js";

// Every agent ccusage reports usage for gets a registry entry, so --editor
// accepts it even when we cannot install a hook for it.
const CCUSAGE_IDS = [
  "claude",
  "codex",
  "opencode",
  "amp",
  "droid",
  "codebuff",
  "hermes",
  "pi",
  "goose",
  "kilo",
  "copilot",
  "gemini",
  "kimi",
  "qwen",
  "openclaw",
];

// Codebuff is the only agent with no session-end mechanism of any kind (no
// event, no plugin surface -- its ~/.config/manicode/ is auth-only), so every
// other registered agent must install a hook.
const NO_HOOK_IDS = ["codebuff"];

describe("platform registry", () => {
  it("covers every agent ccusage supports", () => {
    expect(PLATFORMS.map((p) => p.id)).toEqual(CCUSAGE_IDS);
  });

  it("derives EDITOR_IDS from the registry plus none", () => {
    expect(EDITOR_IDS).toEqual([...PLATFORMS.map((p) => p.id), "none"]);
    expect(EDITOR_IDS).toContain("claude");
    expect(EDITOR_IDS).toContain("none");
  });

  it("resolves platforms by id", () => {
    expect(getPlatform("claude")?.label).toBe("Claude Code");
    expect(getPlatform("codex")?.label).toBe("Codex");
    expect(getPlatform("bogus")).toBeUndefined();
  });

  it("gives every platform a non-empty label", () => {
    for (const p of PLATFORMS) expect(p.label).not.toBe("");
  });

  // init silently falls back to the "no hook installed" note for a platform
  // without one, so a dropped installHook would stop syncing that agent with no
  // visible error. Pin the exact set.
  it("provides installHook for every agent except the one with no mechanism", () => {
    const withHook = PLATFORMS.filter((p) => p.installHook).map((p) => p.id);
    const expected = CCUSAGE_IDS.filter((id) => !NO_HOOK_IDS.includes(id));
    expect(withHook.sort()).toEqual([...expected].sort());
  });

  it("hook command invokes ccusage-hub in quiet mode", () => {
    expect(HOOK_COMMAND).toContain("ccusage-hub");
    expect(HOOK_COMMAND).toContain("--quiet");
  });
});

describe("hookCommand", () => {
  // Platforms with a real once-per-session event should not pay for a throttle.
  it("has no throttle by default", () => {
    expect(hookCommand()).toBe(HOOK_COMMAND);
    expect(hookCommand()).not.toContain("--min-interval");
  });

  it("adds the throttle for per-turn platforms", () => {
    expect(hookCommand(PER_TURN_MIN_INTERVAL_SECONDS)).toBe(
      `${HOOK_COMMAND} --min-interval ${PER_TURN_MIN_INTERVAL_SECONDS}`,
    );
  });

  // The installers find our existing entry by the "ccusage-hub" substring. If a
  // throttled command ever stopped matching, re-running init against a per-turn
  // platform would silently stack a duplicate hook on every run.
  it("stays matchable by the shared dedupe predicate", () => {
    const throttled = hookCommand(PER_TURN_MIN_INTERVAL_SECONDS);
    expect(throttled).toContain("ccusage-hub");
    expect(entryRunsCcusageHub({ hooks: [{ type: "command", command: throttled }] })).toBe(true);
  });
});

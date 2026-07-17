import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { countOccurrences, installerFor, useTmpDir } from "./hook-test-utils.js";
import { HOOK_COMMAND } from "./types.js";

const tmp = useTmpDir();
const install = (path?: string): string => installerFor("hermes")(path);

describe("installHermesHook", () => {
  it("creates config.yaml (and parent dirs) on fresh install", () => {
    const path = join(tmp(), "nested", "config.yaml");
    expect(install(path)).toBe(`hook installed (${path})`);
    expect(countOccurrences(readFileSync(path, "utf8"), HOOK_COMMAND)).toBe(1);
  });

  // Intent: `on_session_end` fires once per TURN (Hermes calls
  // run_conversation() per user message), which would spawn npx on every
  // message. on_session_finalize is the only genuine end-of-session event.
  it("subscribes to on_session_finalize, never the per-turn on_session_end", () => {
    const path = join(tmp(), "config.yaml");
    install(path);
    const parsed = parse(readFileSync(path, "utf8"));
    expect(parsed.hooks.on_session_finalize).toEqual([
      { command: HOOK_COMMAND, timeout: 30 },
    ]);
    expect(parsed.hooks.on_session_end).toBeUndefined();
  });

  // Without auto-accept the first run blocks on an interactive consent prompt,
  // which is useless for an unattended sync hook.
  it("enables hooks_auto_accept when the user has not set it", () => {
    const path = join(tmp(), "config.yaml");
    install(path);
    expect(parse(readFileSync(path, "utf8")).hooks_auto_accept).toBe(true);
  });

  it("is idempotent on re-run", () => {
    const path = join(tmp(), "config.yaml");
    install(path);
    expect(install(path)).toBe(`hook already installed (${path})`);
    expect(countOccurrences(readFileSync(path, "utf8"), HOOK_COMMAND)).toBe(1);
  });

  // An explicit false is a deliberate user choice; installing the hook is fine
  // but silently flipping their global consent setting is not.
  it("respects hooks_auto_accept: false and tells the user instead", () => {
    const path = join(tmp(), "config.yaml");
    writeFileSync(path, "hooks_auto_accept: false\n");
    const msg = install(path);
    const parsed = parse(readFileSync(path, "utf8"));
    expect(parsed.hooks_auto_accept).toBe(false); // never flipped behind their back
    expect(parsed.hooks.on_session_finalize).toHaveLength(1); // hook still installed
    expect(msg).toContain("hooks_auto_accept: true");
    expect(msg).toContain("--accept-hooks");
  });

  it("preserves unrelated settings, existing hooks and comments", () => {
    const path = join(tmp(), "config.yaml");
    writeFileSync(
      path,
      "# my hermes config\nmodel: sonnet\nhooks:\n  on_session_start:\n    - command: echo hi\n",
    );
    install(path);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("# my hermes config"); // Document API keeps comments
    const parsed = parse(text);
    expect(parsed.model).toBe("sonnet");
    expect(parsed.hooks.on_session_start).toEqual([{ command: "echo hi" }]);
    expect(parsed.hooks.on_session_finalize).toHaveLength(1);
  });

  it("appends to an existing on_session_finalize list", () => {
    const path = join(tmp(), "config.yaml");
    writeFileSync(path, "hooks:\n  on_session_finalize:\n    - command: echo hi\n");
    install(path);
    const parsed = parse(readFileSync(path, "utf8"));
    expect(parsed.hooks.on_session_finalize).toHaveLength(2);
    expect(parsed.hooks.on_session_finalize[0].command).toBe("echo hi");
  });

  it("throws on malformed YAML without overwriting", () => {
    const path = join(tmp(), "config.yaml");
    const bad = "hooks:\n  - [unclosed\n";
    writeFileSync(path, bad);
    expect(() => install(path)).toThrow("is not valid YAML");
    expect(() => install(path)).toThrow("refusing to overwrite");
    expect(readFileSync(path, "utf8")).toBe(bad);
  });

  it("throws when the document is not a mapping", () => {
    const path = join(tmp(), "config.yaml");
    writeFileSync(path, "- just\n- a\n- list\n");
    expect(() => install(path)).toThrow("is not a YAML mapping");
  });

  it("throws when hooks.on_session_finalize is not a list", () => {
    const path = join(tmp(), "config.yaml");
    writeFileSync(path, "hooks:\n  on_session_finalize: nope\n");
    expect(() => install(path)).toThrow('"hooks.on_session_finalize" is not a list');
  });
});

import { describe, expect, it } from "vitest";
import { parseArgs } from "./args.js";

describe("parseArgs", () => {
  it("collects positional arguments", () => {
    const flags = parseArgs(["sync", "extra"], []);
    expect(flags.positional).toEqual(["sync", "extra"]);
    expect(flags.bool.size).toBe(0);
    expect(flags.value.size).toBe(0);
  });

  it("collects boolean flags", () => {
    const flags = parseArgs(["--quiet", "--dry-run"], []);
    expect(flags.bool.has("quiet")).toBe(true);
    expect(flags.bool.has("dry-run")).toBe(true);
  });

  it("collects value flags with their values", () => {
    const flags = parseArgs(["--editor", "claude", "--key", "ccu_x"], ["editor", "key"]);
    expect(flags.value.get("editor")).toBe("claude");
    expect(flags.value.get("key")).toBe("ccu_x");
  });

  // A value flag must not swallow a following flag as its value; the flag is
  // recorded as present-but-empty so commands can report it as invalid.
  it("treats a value flag followed by another flag as missing its value", () => {
    const flags = parseArgs(["--since-days", "--quiet"], ["since-days"]);
    expect(flags.value.get("since-days")).toBe("");
    expect(flags.bool.has("quiet")).toBe(true);
  });

  it("treats a value flag at the end of argv as missing its value", () => {
    const flags = parseArgs(["--editor"], ["editor"]);
    expect(flags.value.get("editor")).toBe("");
  });

  it("keeps the last occurrence of a repeated value flag", () => {
    const flags = parseArgs(["--editor", "codex", "--editor", "claude"], ["editor"]);
    expect(flags.value.get("editor")).toBe("claude");
  });

  it("mixes positionals, booleans, and values", () => {
    const flags = parseArgs(["init", "--yes", "--machine", "m1"], ["machine"]);
    expect(flags.positional).toEqual(["init"]);
    expect(flags.bool.has("yes")).toBe(true);
    expect(flags.value.get("machine")).toBe("m1");
  });
});

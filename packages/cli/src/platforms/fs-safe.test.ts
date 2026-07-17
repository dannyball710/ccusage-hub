import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWrite, backupPath, installSafely, readIfExists, type SafeInstall } from "./fs-safe.js";
import { useTmpDir } from "./hook-test-utils.js";

const tmp = useTmpDir();

// A minimal JSON-shaped config: { keep: ..., hooks: [...] }.
interface Doc {
  [key: string]: unknown;
}

function isDoc(v: unknown): v is Doc {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function spec(path: string, overrides: Partial<SafeInstall<Doc>> = {}): SafeInstall<Doc> {
  return {
    settingsPath: path,
    parse: (raw) => {
      const parsed: unknown = JSON.parse(raw);
      if (!isDoc(parsed)) throw new Error("not an object. refusing to overwrite.");
      return parsed;
    },
    create: () => ({}),
    topLevelKeys: (doc) => Object.keys(doc),
    hasHook: (doc) => Array.isArray(doc.hooks) && doc.hooks.includes("ccusage-hub"),
    addHook: (doc) => {
      doc.hooks = Array.isArray(doc.hooks) ? [...doc.hooks, "ccusage-hub"] : ["ccusage-hub"];
    },
    serialize: (doc) => JSON.stringify(doc, null, 2) + "\n",
    ...overrides,
  };
}

describe("atomicWrite", () => {
  it("creates parent dirs and writes the file", () => {
    const path = join(tmp(), "a", "b", "f.txt");
    atomicWrite(path, "hello");
    expect(readFileSync(path, "utf8")).toBe("hello");
  });

  it("replaces an existing file", () => {
    const path = join(tmp(), "f.txt");
    writeFileSync(path, "old");
    atomicWrite(path, "new");
    expect(readFileSync(path, "utf8")).toBe("new");
  });

  // A temp file left behind would be mistaken for a real config by anything
  // globbing the directory, and would leak the user's settings.
  it("leaves no temp file behind on success or failure", () => {
    const path = join(tmp(), "f.txt");
    atomicWrite(path, "ok");
    expect(readdirSync(tmp())).toEqual(["f.txt"]);

    // A directory at the target makes rename fail after the temp file exists.
    const blocked = join(tmp(), "dir");
    mkdirSync(blocked);
    mkdirSync(join(blocked, "child")); // non-empty: rename cannot replace it
    expect(() => atomicWrite(blocked, "boom")).toThrow();
    expect(readdirSync(tmp()).sort()).toEqual(["dir", "f.txt"]);
  });
});

describe("readIfExists", () => {
  it("returns null for a missing file", () => {
    expect(readIfExists(join(tmp(), "nope.json"))).toBeNull();
  });

  // Only ENOENT is safe to treat as "start fresh"; anything else means we
  // failed to read a file that may well exist.
  it("throws for an unreadable path rather than reporting it missing", () => {
    const path = join(tmp(), "dir");
    mkdirSync(path);
    expect(() => readIfExists(path)).toThrow("cannot read");
  });
});

describe("installSafely", () => {
  it("writes a fresh file with no backup", () => {
    const path = join(tmp(), "c.json");
    expect(installSafely(spec(path))).toBe(`hook installed (${path})`);
    expect(existsSync(backupPath(path))).toBe(false);
  });

  it("backs up an existing file and reports where", () => {
    const path = join(tmp(), "c.json");
    writeFileSync(path, JSON.stringify({ keep: 1 }));
    const msg = installSafely(spec(path));
    expect(msg).toContain(`backup: ${backupPath(path)}`);
    expect(JSON.parse(readFileSync(backupPath(path), "utf8"))).toEqual({ keep: 1 });
  });

  it("preserves the user's other top-level keys", () => {
    const path = join(tmp(), "c.json");
    writeFileSync(path, JSON.stringify({ keep: 1, other: "x" }));
    installSafely(spec(path));
    const after = JSON.parse(readFileSync(path, "utf8"));
    expect(after.keep).toBe(1);
    expect(after.other).toBe("x");
  });

  it("is idempotent and does not write on re-run", () => {
    const path = join(tmp(), "c.json");
    installSafely(spec(path));
    expect(installSafely(spec(path))).toBe(`hook already installed (${path})`);
  });

  // The point of post-write verification: catch a serializer that silently
  // drops data, which no amount of checking our in-memory doc would find.
  it("rolls back and throws when the write loses the user's settings", () => {
    const path = join(tmp(), "c.json");
    const original = JSON.stringify({ keep: 1, other: "x" });
    writeFileSync(path, original);

    const dropsKeys = spec(path, {
      serialize: (doc) => JSON.stringify({ hooks: doc.hooks }, null, 2) + "\n",
    });
    expect(() => installSafely(dropsKeys)).toThrow("these settings were lost: keep, other");
    expect(() => installSafely(dropsKeys)).toThrow("has been restored");
    expect(readFileSync(path, "utf8")).toBe(original); // byte-for-byte
  });

  it("rolls back when the hook is missing from what landed on disk", () => {
    const path = join(tmp(), "c.json");
    const original = JSON.stringify({ keep: 1 });
    writeFileSync(path, original);

    const dropsHook = spec(path, { serialize: (doc) => JSON.stringify({ keep: doc.keep }) });
    expect(() => installSafely(dropsHook)).toThrow("the hook entry is not present");
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  // Rolling back to "the file that was there before" means no file at all.
  it("removes the file when verification fails on a fresh install", () => {
    const path = join(tmp(), "c.json");
    const dropsHook = spec(path, { serialize: () => JSON.stringify({}) });
    expect(() => installSafely(dropsHook)).toThrow("failed verification");
    expect(existsSync(path)).toBe(false);
  });

  it("aborts without writing when the existing file is malformed", () => {
    const path = join(tmp(), "c.json");
    writeFileSync(path, "{not json");
    expect(() => installSafely(spec(path))).toThrow();
    expect(readFileSync(path, "utf8")).toBe("{not json");
    expect(existsSync(backupPath(path))).toBe(false); // never even got to the write
  });
});

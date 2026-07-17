import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLastSyncAt, statePath, writeLastSyncAt } from "./state.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), "ccusage-hub-state-"));
  process.env.CCUSAGE_HUB_CONFIG = join(tmpDir, "config.json");
});

afterEach(() => {
  delete process.env.CCUSAGE_HUB_CONFIG;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("statePath", () => {
  // Derived from the config path so CCUSAGE_HUB_CONFIG isolates tests, but
  // never the config file itself -- that one is the user's to hand-edit.
  it("sits beside the config without replacing it", () => {
    expect(statePath()).toBe(join(tmpDir, "config.state.json"));
    expect(statePath()).not.toBe(process.env.CCUSAGE_HUB_CONFIG);
  });

  it("appends cleanly when the config path has no .json suffix", () => {
    process.env.CCUSAGE_HUB_CONFIG = join(tmpDir, "cfg");
    expect(statePath()).toBe(join(tmpDir, "cfg.state.json"));
  });
});

describe("last sync state", () => {
  it("round-trips a timestamp", () => {
    writeLastSyncAt(1700000000000);
    expect(readLastSyncAt()).toBe(1700000000000);
  });

  it("reports never-synced when the state file is missing", () => {
    expect(readLastSyncAt()).toBeNull();
  });

  // Fail open toward syncing: a corrupt state file must never be an error, and
  // must never suppress a sync. A missed sync loses data; a redundant one does not.
  it("reports never-synced for a corrupt state file", () => {
    writeFileSync(statePath(), "{not json");
    expect(readLastSyncAt()).toBeNull();
  });

  it("reports never-synced when lastSyncAt has the wrong type", () => {
    writeFileSync(statePath(), JSON.stringify({ lastSyncAt: "yesterday" }));
    expect(readLastSyncAt()).toBeNull();
  });

  it("reports never-synced when the state file is an array", () => {
    writeFileSync(statePath(), JSON.stringify([1, 2]));
    expect(readLastSyncAt()).toBeNull();
  });

  // An unwritable state file must not throw: sync already succeeded by then,
  // and --quiet must still exit 0.
  it("swallows a write failure instead of throwing", () => {
    mkdirSync(statePath()); // a directory at the state path makes the write fail
    expect(() => writeLastSyncAt(Date.now())).not.toThrow();
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { getPlatform } from "./index.js";

export const BOM = String.fromCharCode(0xfeff);

// Resolves an installer through the public registry, so a provider wired up
// incorrectly fails its own tests rather than silently going untested.
export function installerFor(id: string): (settingsPath?: string) => string {
  const platform = getPlatform(id);
  if (!platform?.installHook) throw new Error(`${id} platform must have installHook`);
  return platform.installHook;
}

export function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// Every installer takes a settingsPath override so tests never touch the real
// config homes (~/.claude, ~/.qwen, ~/.factory, ...).
export function useTmpDir(): () => string {
  let tmpDir = "";
  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "ccusage-hub-platforms-"));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
  return () => tmpDir;
}

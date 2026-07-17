import { readFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { errnoCode, errorMessage } from "../errors.js";

export const FIX_HINT = "Fix it manually or pass --settings-path; refusing to overwrite.";

// Windows editors (Notepad, PowerShell Set-Content) prefix a UTF-8 BOM, which
// JSON.parse and the TOML parser both reject.
export function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

// Returns null only when the file is missing -- the one case where starting
// fresh is safe. Any other read failure (permissions, a directory in the way)
// aborts, so we never clobber a config we merely failed to read.
export function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (errnoCode(err) === "ENOENT") return null;
    throw new Error(`cannot read ${path}: ${errorMessage(err)}. ${FIX_HINT}`);
  }
}

// Writes via a temp file in the SAME directory + rename. rename is atomic and
// replaces the target on both POSIX and Windows, so a crash mid-write can never
// leave a truncated config behind -- readers see either the old file or the new.
export function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(dirname(path), `.${basename(path)}.ccusage-hub-tmp-${process.pid}`);
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true }); // never leave the temp file behind
    throw err;
  }
}

export function backupPath(path: string): string {
  return `${path}.ccusage-hub-bak`;
}

// A user-owned config in some format we can parse, mutate and re-serialize.
// The same hasHook predicate does double duty: it dedupes before the write and
// proves the hook survived after it.
export interface SafeInstall<T> {
  settingsPath: string;
  parse: (raw: string) => T; // must throw (with FIX_HINT) on malformed input
  create: () => T; // document to start from when the file does not exist
  topLevelKeys: (doc: T) => string[];
  hasHook: (doc: T) => boolean;
  addHook: (doc: T) => void;
  // Produces the bytes to write. `original` is the file's prior content (null if
  // it did not exist), so a format with no comment-preserving serializer (TOML)
  // can APPEND to the user's exact bytes instead of round-tripping and losing
  // their comments. Formats with a lossless writer just serialize `doc`.
  serialize: (doc: T, original: string | null) => string;
}

// Re-reads and re-parses what we just wrote. This is the check that catches
// serializer bugs rather than our own logic errors: our in-memory document
// being right proves nothing about the bytes that landed on disk.
function verifyWrite<T>(spec: SafeInstall<T>, keysBefore: string[]): void {
  const raw = readIfExists(spec.settingsPath);
  if (raw === null) throw new Error("the file is missing");
  const doc = spec.parse(raw);
  if (!spec.hasHook(doc)) throw new Error("the hook entry is not present");
  const after = new Set(spec.topLevelKeys(doc));
  const lost = keysBefore.filter((key) => !after.has(key));
  if (lost.length > 0) throw new Error(`these settings were lost: ${lost.join(", ")}`);
}

export function installSafely<T>(spec: SafeInstall<T>): string {
  const { settingsPath, parse, create, topLevelKeys, hasHook, addHook, serialize } = spec;

  const original = readIfExists(settingsPath);
  const doc = original === null ? create() : parse(original);
  // Captured before hasHook, which may create the empty containers it looks in.
  const keysBefore = topLevelKeys(doc);
  if (hasHook(doc)) return `hook already installed (${settingsPath})`;

  addHook(doc);
  const text = serialize(doc, original);

  // Back up the user's bytes before the first write, so they have a recovery
  // path even if this process dies between here and the verification below.
  const backup = original === null ? null : backupPath(settingsPath);
  if (backup !== null && original !== null) atomicWrite(backup, original);

  atomicWrite(settingsPath, text);

  try {
    verifyWrite(spec, keysBefore);
  } catch (err) {
    // Restore the original bytes we still hold in memory; a file that never
    // existed is removed rather than left half-written.
    if (original === null) rmSync(settingsPath, { force: true });
    else atomicWrite(settingsPath, original);
    throw new Error(
      `${settingsPath} failed verification after write (${errorMessage(err)}); ` +
        `your original file has been restored. ${FIX_HINT}`,
    );
  }

  if (backup === null) return `hook installed (${settingsPath})`;
  return `hook installed (${settingsPath}; backup: ${backup})`;
}

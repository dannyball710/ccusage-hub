import { FIX_HINT, installSafely, stripBom } from "./fs-safe.js";

// Config files are user-owned: only the pieces we touch are validated (with
// granular error messages), and everything else is preserved as-is.
export interface JsonObject {
  [key: string]: unknown;
}

export function isJsonObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseJsonObject(raw: string, settingsPath: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch {
    throw new Error(`${settingsPath} is not valid JSON. ${FIX_HINT}`);
  }
  if (!isJsonObject(parsed)) throw new Error(`${settingsPath} is not a JSON object. ${FIX_HINT}`);
  return parsed;
}

// Returns parent[key] as an object, creating it when absent. label names the
// key in error messages using its full dotted path.
export function objectAt(
  parent: JsonObject,
  key: string,
  settingsPath: string,
  label: string = key,
): JsonObject {
  const current = parent[key];
  if (current === undefined) {
    const created: JsonObject = {};
    parent[key] = created;
    return created;
  }
  if (!isJsonObject(current)) {
    throw new Error(`${settingsPath} "${label}" is not an object. ${FIX_HINT}`);
  }
  return current;
}

export function arrayAt(
  parent: JsonObject,
  key: string,
  settingsPath: string,
  label: string = key,
): unknown[] {
  const current = parent[key];
  if (current === undefined) {
    const created: unknown[] = [];
    parent[key] = created;
    return created;
  }
  if (!Array.isArray(current)) {
    throw new Error(`${settingsPath} "${label}" is not an array. ${FIX_HINT}`);
  }
  return current;
}

// Matches the Claude-shaped entry `{ hooks: [{ command }] }` used by claude,
// qwen, droid and goose. Copilot's flat schema needs its own predicate.
export function entryRunsCcusageHub(entry: unknown): boolean {
  if (!isJsonObject(entry) || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some(
    (h: unknown) =>
      isJsonObject(h) && typeof h.command === "string" && h.command.includes("ccusage-hub"),
  );
}

export interface JsonHookMerge {
  settingsPath: string;
  // Locates the array of hook entries for the target event, creating any
  // missing ancestors. Throws when the user's file has an incompatible shape.
  selectEntries: (root: JsonObject) => unknown[];
  buildEntry: () => unknown;
  isOurs: (entry: unknown) => boolean;
}

// Merges a hook entry into a user-owned JSON config, leaving every other key
// untouched. Idempotent, atomic, backed up and verified -- see fs-safe.ts.
export function mergeJsonHook({
  settingsPath,
  selectEntries,
  buildEntry,
  isOurs,
}: JsonHookMerge): string {
  return installSafely<JsonObject>({
    settingsPath,
    parse: (raw) => parseJsonObject(raw, settingsPath),
    create: () => ({}),
    topLevelKeys: (root) => Object.keys(root),
    hasHook: (root) => selectEntries(root).some(isOurs),
    addHook: (root) => {
      selectEntries(root).push(buildEntry());
    },
    serialize: (root) => JSON.stringify(root, null, 2) + "\n",
  });
}

import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import { FIX_HINT, installSafely, stripBom } from "./fs-safe.js";
import { isJsonObject } from "./json-merge.js";
import { HOOK_COMMAND, type Platform } from "./types.js";

const TIMEOUT_SEC = 30;

interface TomlTable {
  [key: string]: unknown;
}

function currentHome(): string {
  return join(os.homedir(), ".kimi-code");
}

function legacyPath(): string {
  return join(os.homedir(), ".kimi", "config.toml");
}

// Kimi is mid-migration between two config homes. Prefer ~/.kimi-code: kimi-code
// auto-migrates the legacy ~/.kimi on install, so a hook written to the legacy
// path can be silently superseded. Only fall back when the new home does not
// exist yet and the legacy one does.
function defaultPath(): string {
  const override = process.env.KIMI_CODE_HOME;
  if (override) return join(override, "config.toml");
  if (!existsSync(currentHome()) && existsSync(join(os.homedir(), ".kimi"))) return legacyPath();
  return join(currentHome(), "config.toml");
}

function tableRunsCcusageHub(table: unknown): boolean {
  return (
    isJsonObject(table) && typeof table.command === "string" && table.command.includes("ccusage-hub")
  );
}

function hooksOf(root: TomlTable, target: string): unknown[] {
  const current = root.hooks;
  if (current === undefined) return [];
  if (!Array.isArray(current)) {
    throw new Error(`${target} "hooks" is not an array of tables. ${FIX_HINT}`);
  }
  return current;
}

// The [[hooks]] block to append. smol-toml renders it (escaping the command
// correctly); we only ever stringify this fresh single-entry table, never the
// user's document, so their comments and formatting are never touched.
// [[hooks]] accepts EXACTLY these four fields -- any extra key makes kimi fail to
// load the user's entire config, not just skip our hook.
function hookBlock(): string {
  return stringify({
    hooks: [
      { event: "SessionEnd", matcher: "exit", command: HOOK_COMMAND, timeout: TIMEOUT_SEC },
    ],
  });
}

// Appends the block to the user's exact bytes. This is safe precisely because
// installSafely already validated the whole file parses: a fresh array-of-tables
// entry at EOF is valid TOML regardless of what precedes it, and table order does
// not matter. A blank line separates it from prior content for readability.
function appendBlock(original: string | null): string {
  const base = original ?? "";
  const separator = base.length === 0 ? "" : base.endsWith("\n") ? "\n" : "\n\n";
  return `${base}${separator}${hookBlock()}`;
}

// Installs by APPENDING rather than round-tripping: smol-toml has no CST, so
// re-serializing the parsed document would silently drop the user's comments.
function installKimiHook(settingsPath?: string): string {
  const target = settingsPath ?? defaultPath();
  const usingLegacy = settingsPath === undefined && target === legacyPath();
  const suffix = usingLegacy ? " (legacy ~/.kimi config; ~/.kimi-code does not exist yet)" : "";

  const message = installSafely<TomlTable>({
    settingsPath: target,
    parse: (raw) => {
      let parsed: unknown;
      try {
        parsed = parse(stripBom(raw));
      } catch {
        throw new Error(`${target} is not valid TOML. ${FIX_HINT}`);
      }
      // parse() always yields a table for valid TOML, but narrow rather than assert.
      if (!isJsonObject(parsed)) throw new Error(`${target} is not a TOML table. ${FIX_HINT}`);
      return parsed;
    },
    create: () => ({}),
    topLevelKeys: (root) => Object.keys(root),
    hasHook: (root) => hooksOf(root, target).some(tableRunsCcusageHub),
    addHook: () => {}, // append happens in serialize, against the original bytes
    serialize: (_root, original) => appendBlock(original),
  });
  return message + suffix;
}

export const kimi: Platform = {
  id: "kimi",
  label: "Kimi",
  installHook: installKimiHook,
};

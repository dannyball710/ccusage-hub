import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { errnoCode, errorMessage } from "./errors.js";

export const HOOK_COMMAND = "npx -y ccusage-hub@latest sync --quiet";

export interface Platform {
  id: string; // value accepted by --editor
  label: string; // human-readable name
  // Installs the auto-sync hook and returns a status message ("hook installed" /
  // "hook already installed"). Absent = platform has no hook mechanism yet;
  // init writes config only. settingsPath overrides the default location.
  installHook?: (settingsPath?: string) => string;
}

const FIX_HINT = "Fix it manually or pass --settings-path; refusing to overwrite.";

interface HookCommand {
  type?: string;
  command?: string;
}
interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
}
// settings.json is user-owned: only the pieces we touch are validated (with
// granular error messages), and everything else is preserved as-is.
interface ClaudeSettings {
  hooks?: unknown;
  [key: string]: unknown;
}
interface HooksMap {
  SessionEnd?: unknown;
  [key: string]: unknown;
}

function isClaudeSettings(v: unknown): v is ClaudeSettings {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isHooksMap(v: unknown): v is HooksMap {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function entryRunsCcusageHub(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null || !("hooks" in entry)) return false;
  if (!Array.isArray(entry.hooks)) return false;
  return entry.hooks.some(
    (h: unknown) =>
      typeof h === "object" &&
      h !== null &&
      "command" in h &&
      typeof h.command === "string" &&
      h.command.includes("ccusage-hub"),
  );
}

function installClaudeHook(
  settingsPath: string = join(os.homedir(), ".claude", "settings.json"),
): string {
  let settings: ClaudeSettings = {};

  // Only a missing file is safe to start fresh; any existing-but-unreadable or
  // malformed file must abort so we never clobber the user's real settings.
  let raw: string | null = null;
  try {
    raw = readFileSync(settingsPath, "utf8");
  } catch (err) {
    if (errnoCode(err) !== "ENOENT") {
      throw new Error(`cannot read ${settingsPath}: ${errorMessage(err)}. ${FIX_HINT}`);
    }
  }

  if (raw !== null) {
    let parsed: unknown;
    try {
      // Strip UTF-8 BOM: Windows editors (Notepad, PowerShell Set-Content) add one.
      parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch {
      throw new Error(`${settingsPath} is not valid JSON. ${FIX_HINT}`);
    }
    if (!isClaudeSettings(parsed)) {
      throw new Error(`${settingsPath} is not a JSON object. ${FIX_HINT}`);
    }
    settings = parsed;
  }

  let hooks: HooksMap;
  if (settings.hooks === undefined) {
    hooks = {};
    settings.hooks = hooks;
  } else if (isHooksMap(settings.hooks)) {
    hooks = settings.hooks;
  } else {
    throw new Error(`${settingsPath} "hooks" is not an object. ${FIX_HINT}`);
  }

  let existing: unknown[];
  if (hooks.SessionEnd === undefined) {
    existing = [];
    hooks.SessionEnd = existing;
  } else if (Array.isArray(hooks.SessionEnd)) {
    existing = hooks.SessionEnd;
  } else {
    throw new Error(`${settingsPath} "hooks.SessionEnd" is not an array. ${FIX_HINT}`);
  }

  if (existing.some(entryRunsCcusageHub)) return `hook already installed (${settingsPath})`;

  const entry: HookEntry = {
    matcher: "*",
    hooks: [{ type: "command", command: HOOK_COMMAND }],
  };
  existing.push(entry);

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return `hook installed (${settingsPath})`;
}

export const PLATFORMS: Platform[] = [
  { id: "claude", label: "Claude Code", installHook: installClaudeHook },
  { id: "codex", label: "Codex CLI" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "copilot", label: "Copilot CLI" },
];

export function getPlatform(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

// Values accepted by --editor; "none" writes config only, skipping any hook.
export const EDITOR_IDS = [...PLATFORMS.map((p) => p.id), "none"];

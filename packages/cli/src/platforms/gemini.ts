import os from "node:os";
import { join } from "node:path";
import { posixDetached, powershellDetached } from "./detach.js";
import { arrayAt, isJsonObject, mergeJsonHook, objectAt } from "./json-merge.js";
import { PER_TURN_MIN_INTERVAL_SECONDS, type Platform } from "./types.js";

// gemini identifies handlers by `name`, so dedupe on that rather than by
// substring-matching the command.
const HANDLER_NAME = "ccusage-hub-sync";

function defaultPath(): string {
  return join(os.homedir(), ".gemini", "settings.json");
}

// gemini has no commandWindows field, and the shell it runs hooks in is
// platform-dependent (PowerShell on Windows, hardcoded bash elsewhere), so one
// string cannot serve both. Choosing at install time is fine -- we know the
// platform then.
function command(): string {
  const throttle = PER_TURN_MIN_INTERVAL_SECONDS;
  return process.platform === "win32" ? powershellDetached(throttle) : posixDetached(throttle);
}

function entryHasOurHandler(entry: unknown): boolean {
  if (!isJsonObject(entry) || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((h: unknown) => isJsonObject(h) && h.name === HANDLER_NAME);
}

// ~/.gemini/settings.json:
// { "hooks": { "SessionEnd": [{ "hooks": [{ "name": ..., "type": "command",
//   "command": ... }] }] } }
//
// SessionEnd is once per session, so the throttle is not strictly needed -- but
// it is harmless (the command detaches either way) and keeps every platform's
// command uniform. gemini AWAITS this hook before exiting despite its "best
// effort" docs, which is why the command must detach; see detach.ts.
function installGeminiHook(settingsPath: string = defaultPath()): string {
  return mergeJsonHook({
    settingsPath,
    selectEntries: (root) =>
      arrayAt(objectAt(root, "hooks", settingsPath), "SessionEnd", settingsPath, "hooks.SessionEnd"),
    // No matcher: for lifecycle events gemini compares `matcher` to `reason` as
    // an EXACT string, so matcher:"exit" would silently miss sessions ended by
    // clear, logout or prompt_input_exit. An absent matcher matches every reason
    // (hookPlanner.matchesContext: "No matcher means match all").
    buildEntry: () => ({
      hooks: [{ name: HANDLER_NAME, type: "command", command: command() }],
    }),
    isOurs: entryHasOurHandler,
  });
}

export const gemini: Platform = {
  id: "gemini",
  label: "Gemini CLI",
  installHook: installGeminiHook,
};

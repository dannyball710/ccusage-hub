import os from "node:os";
import { join } from "node:path";
import { FIX_HINT } from "./fs-safe.js";
import { arrayAt, isJsonObject, mergeJsonHook, objectAt } from "./json-merge.js";
import { HOOK_COMMAND, type Platform } from "./types.js";

const HOOKS_VERSION = 1;
const TIMEOUT_SEC = 30;

function defaultPath(): string {
  return join(os.homedir(), ".copilot", "hooks", "notification-hooks.json");
}

// Copilot's entries are flat -- the command sits directly on the entry rather
// than in a nested `hooks` array -- so the Claude-shaped predicate never matches.
function entryRunsCcusageHub(entry: unknown): boolean {
  if (!isJsonObject(entry)) return false;
  return [entry.bash, entry.powershell].some(
    (cmd) => typeof cmd === "string" && cmd.includes("ccusage-hub"),
  );
}

// ~/.copilot/hooks/notification-hooks.json:
// { "version": 1, "hooks": { "sessionEnd": [{ "type": "command", "bash": ...,
//   "powershell": ..., "timeoutSec": 30 }] } }
// Note the lowercase event name and the dual bash/powershell keys.
function installCopilotHook(settingsPath: string = defaultPath()): string {
  return mergeJsonHook({
    settingsPath,
    selectEntries: (root) => {
      // A different version means a schema we have not seen; appending our
      // entry to it could silently produce a file Copilot rejects wholesale.
      const version = root.version;
      if (version === undefined) root.version = HOOKS_VERSION;
      else if (version !== HOOKS_VERSION) {
        throw new Error(
          `${settingsPath} "version" is ${JSON.stringify(version)}, expected ${HOOKS_VERSION}. ${FIX_HINT}`,
        );
      }
      return arrayAt(
        objectAt(root, "hooks", settingsPath),
        "sessionEnd",
        settingsPath,
        "hooks.sessionEnd",
      );
    },
    // HOOK_COMMAND is cross-platform, so the same string serves both shells.
    buildEntry: () => ({
      type: "command",
      bash: HOOK_COMMAND,
      powershell: HOOK_COMMAND,
      timeoutSec: TIMEOUT_SEC,
    }),
    isOurs: entryRunsCcusageHub,
  });
}

export const copilot: Platform = {
  id: "copilot",
  label: "GitHub Copilot CLI",
  installHook: installCopilotHook,
};

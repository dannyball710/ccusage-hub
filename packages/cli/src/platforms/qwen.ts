import os from "node:os";
import { join } from "node:path";
import { arrayAt, entryRunsCcusageHub, mergeJsonHook, objectAt } from "./json-merge.js";
import { HOOK_COMMAND, type Platform } from "./types.js";

function defaultPath(): string {
  return join(os.homedir(), ".qwen", "settings.json");
}

// ~/.qwen/settings.json, byte-for-byte the same shape as Claude's except for
// the matcher: on SessionEnd, qwen treats `matcher` as a regex against the exit
// *reason*, so omitting it is what catches every session end.
//
// A top-level `disableAllHooks: true` silently disables this hook. We install
// anyway rather than fail -- the user can flip the flag back on their own.
function installQwenHook(settingsPath: string = defaultPath()): string {
  return mergeJsonHook({
    settingsPath,
    selectEntries: (root) =>
      arrayAt(objectAt(root, "hooks", settingsPath), "SessionEnd", settingsPath, "hooks.SessionEnd"),
    // Qwen expands $VAR and ${VAR} inside settings.json string values at load
    // time. HOOK_COMMAND has no `$` today, so this is latent -- but adding one
    // would be silently rewritten before the hook ever runs.
    buildEntry: () => ({ hooks: [{ type: "command", command: HOOK_COMMAND }] }),
    isOurs: entryRunsCcusageHub,
  });
}

export const qwen: Platform = {
  id: "qwen",
  label: "Qwen",
  installHook: installQwenHook,
};

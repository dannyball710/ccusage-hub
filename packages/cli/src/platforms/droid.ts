import os from "node:os";
import { join } from "node:path";
import { arrayAt, entryRunsCcusageHub, mergeJsonHook, objectAt } from "./json-merge.js";
import { HOOK_COMMAND, type Platform } from "./types.js";

// Hooks live in ~/.factory/hooks.json, NOT settings.json -- settings.json is a
// documented legacy fallback that now only carries the `hooksDisabled` toggle.
function defaultPath(): string {
  return join(os.homedir(), ".factory", "hooks.json");
}

// { "hooks": { "SessionEnd": [{ "hooks": [{ "type": "command", ... }] }] } }
// No version field, and SessionEnd is a non-matcher event -- no `matcher` key.
function installDroidHook(settingsPath: string = defaultPath()): string {
  return mergeJsonHook({
    settingsPath,
    selectEntries: (root) =>
      arrayAt(objectAt(root, "hooks", settingsPath), "SessionEnd", settingsPath, "hooks.SessionEnd"),
    buildEntry: () => ({ hooks: [{ type: "command", command: HOOK_COMMAND }] }),
    isOurs: entryRunsCcusageHub,
  });
}

export const droid: Platform = {
  id: "droid",
  label: "Droid",
  installHook: installDroidHook,
};

import os from "node:os";
import { join } from "node:path";
import { arrayAt, entryRunsCcusageHub, mergeJsonHook, objectAt } from "./json-merge.js";
import { HOOK_COMMAND, type Platform } from "./types.js";

function defaultPath(): string {
  return join(os.homedir(), ".claude", "settings.json");
}

// ~/.claude/settings.json:
// { "hooks": { "SessionEnd": [{ "matcher": "*", "hooks": [{ "type": "command", ... }] }] } }
function installClaudeHook(settingsPath: string = defaultPath()): string {
  return mergeJsonHook({
    settingsPath,
    selectEntries: (root) =>
      arrayAt(objectAt(root, "hooks", settingsPath), "SessionEnd", settingsPath, "hooks.SessionEnd"),
    buildEntry: () => ({
      matcher: "*",
      hooks: [{ type: "command", command: HOOK_COMMAND }],
    }),
    isOurs: entryRunsCcusageHub,
  });
}

export const claude: Platform = {
  id: "claude",
  label: "Claude Code",
  installHook: installClaudeHook,
};

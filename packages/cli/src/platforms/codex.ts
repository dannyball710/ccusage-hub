import os from "node:os";
import { join } from "node:path";
import { cmdDetached, posixDetached } from "./detach.js";
import { arrayAt, entryRunsCcusageHub, mergeJsonHook, objectAt } from "./json-merge.js";
import { PER_TURN_MIN_INTERVAL_SECONDS, type Platform } from "./types.js";

// Codex runs Stop hooks synchronously and blocks the user's turn until they
// exit. If `timeout` is omitted it defaults to 600s, so a hung npx would wedge a
// turn for ten minutes -- always send an explicit, short one. Our command
// detaches and returns in milliseconds, so this is only a backstop.
const TIMEOUT_SEC = 10;

function defaultPath(): string {
  return join(process.env.CODEX_HOME || join(os.homedir(), ".codex"), "hooks.json");
}

// ~/.codex/hooks.json:
// { "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": ...,
//   "commandWindows": ..., "timeout": 10 }] }] } }
//
// `Stop` fires once per TURN, not per session, so the command carries a throttle
// -- the hook runs on every assistant reply but only scans once per window.
//
// Both command forms are emitted regardless of the installing platform, so a
// config in a shared home directory works from either OS. No `matcher`: it is
// optional and ignored for Stop.
function installCodexHook(settingsPath: string = defaultPath()): string {
  return mergeJsonHook({
    settingsPath,
    selectEntries: (root) =>
      arrayAt(objectAt(root, "hooks", settingsPath), "Stop", settingsPath, "hooks.Stop"),
    buildEntry: () => ({
      hooks: [
        {
          type: "command",
          command: posixDetached(PER_TURN_MIN_INTERVAL_SECONDS),
          commandWindows: cmdDetached(PER_TURN_MIN_INTERVAL_SECONDS),
          timeout: TIMEOUT_SEC,
        },
      ],
    }),
    // Codex handlers carry no identity field (upstream still has a TODO for a
    // durable hook id), so match the command substring instead.
    isOurs: entryRunsCcusageHub,
  });
}

export const codex: Platform = {
  id: "codex",
  label: "Codex",
  installHook: installCodexHook,
};

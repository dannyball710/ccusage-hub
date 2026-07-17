import os from "node:os";
import { join } from "node:path";
import { atomicWrite, readIfExists } from "./fs-safe.js";
import { HOOK_COMMAND, type Platform } from "./types.js";

// Goose follows the Open Plugins spec: hooks are declared by a plugin that owns
// its own directory, so this file is ours to write whole rather than merge into.
//
// Verified against block/goose v1.43.0 (crates/goose/src/plugins/discovery.rs,
// formats/open_plugins.rs, config/paths.rs):
//   - a bare plugin directory IS discovered by default. list_dir_children only
//     requires the directory to exist, read_manifest tolerates a missing
//     plugin.json (it infers the name from the directory), and hooks/hooks.json
//     is itself a recognised component marker -- no manifest needed.
//   - both enable gates default to on: is_enabled() returns true for a plugin
//     absent from enabledPlugins/disabledPlugins, and filter_by_config() inserts
//     unknown plugins into config.yaml's `plugins` map with enabled: true.
//   - SessionEnd is genuinely emitted once per session, interactive and headless
//     alike, and hook failures are logged but never block goose.
// A user can still disable us via disabledPlugins in ~/.config/goose/settings.json
// or that config.yaml entry; both are theirs to own, so we do not touch them.
function defaultPath(): string {
  // Plugins live under the HOME dir on every platform (strategy.home_dir()),
  // never AppData. GOOSE_PATH_ROOT is goose's own test-harness override, but
  // when it is set goose really does read plugins from there -- honouring it
  // keeps us from installing a hook that silently never fires.
  const base = process.env.GOOSE_PATH_ROOT || os.homedir();
  return join(base, ".agents", "plugins", "ccusage-hub", "hooks", "hooks.json");
}

function installGooseHook(settingsPath: string = defaultPath()): string {
  // We own this file, so no backup/rollback dance -- but a read that fails for
  // any reason other than "not there yet" means something unexpected occupies
  // the path, and clobbering it blind would be wrong.
  const raw = readIfExists(settingsPath);
  if (raw !== null && raw.includes(HOOK_COMMAND)) {
    return `hook already installed (${settingsPath})`;
  }

  // Payload is {event, session_id} JSON on stdin, run via `sh -c` with a 30s
  // default timeout. Our command ignores stdin and needs no shell features.
  atomicWrite(
    settingsPath,
    JSON.stringify(
      { hooks: { SessionEnd: [{ hooks: [{ type: "command", command: HOOK_COMMAND }] }] } },
      null,
      2,
    ) + "\n",
  );
  return `hook installed (${settingsPath})`;
}

export const goose: Platform = {
  id: "goose",
  label: "Goose",
  installHook: installGooseHook,
};

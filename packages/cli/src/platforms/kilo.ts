import { join } from "node:path";
import { idlePluginSource } from "./opencode.js";
import { installOwnedFile, PLUGIN_BASENAME, xdgConfigHome } from "./plugin-file.js";
import type { Platform } from "./types.js";

// Kilo CLI (Kilo-Org/kilocode) is a fork of OpenCode and keeps the same plugin
// loader, so it shares OpenCode's plugin source and the same session.idle event.
//
// TRAP: `experimental.hook.session_completed` DOES appear in the SDK types
// (packages/sdk/js/src/gen/types.gen.ts) with an inviting {command: string[]}
// shape. It is a stale generated artifact -- the live Effect Schema that
// actually validates config (packages/core/src/v1/config/config.ts) has no
// `hook` key, so a hook written against that type would parse and then silently
// never fire. Hence the plugin file rather than a config entry.
function defaultPath(): string {
  // KILO_CONFIG_DIR relocates the whole config dir; when set, the loader really
  // does read plugins from there, so honouring it keeps us from installing a
  // plugin that never loads.
  const base = process.env.KILO_CONFIG_DIR || join(xdgConfigHome(), "kilo");
  return join(base, "plugin", `${PLUGIN_BASENAME}.ts`);
}

function installKiloHook(settingsPath: string = defaultPath()): string {
  // Unlike OpenCode, Kilo's loader takes the default export as a descriptor
  // object. `id` is diagnostics-only and is not enforced unique.
  return installOwnedFile(
    settingsPath,
    idlePluginSource(`export default { id: "${PLUGIN_BASENAME}", server: createPlugin }`),
  ).message;
}

export const kilo: Platform = {
  id: "kilo",
  label: "Kilo",
  installHook: installKiloHook,
};

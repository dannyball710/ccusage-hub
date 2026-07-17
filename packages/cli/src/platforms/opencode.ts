import { join } from "node:path";
import {
  GENERATED_HEADER,
  installOwnedFile,
  PLUGIN_BASENAME,
  spawnSnippet,
  xdgConfigHome,
} from "./plugin-file.js";
import { hookArgv, PER_TURN_MIN_INTERVAL_SECONDS, type Platform } from "./types.js";

// OpenCode auto-loads every plugin it finds via Glob.scan("{plugin,plugins}/*.{ts,js}")
// at startup: no config key, no enable gate, no CLI registration. Dropping the
// file in is the whole install. The runtime is Bun, so the .ts loads natively.
//
// Kilo is a fork with the same loader, so it reuses this source builder.
//
// The plugin body is emitted as text rather than compiled from a real module
// because it runs inside the agent's process, not ours -- it is data to us.
export function idlePluginSource(exportStatement: string): string {
  return `${GENERATED_HEADER}import { spawn } from "node:child_process"

const createPlugin = async () => ({
  event: async ({ event }) => {
    // session.idle is marked deprecated in OpenCode's source in favour of
    // session.status with properties.status.type === "idle". Both are handled so
    // this keeps firing once the deprecated event is finally removed.
    const isIdle =
      event.type === "session.idle" ||
      (event.type === "session.status" && event.properties?.status?.type === "idle")
    if (!isIdle) return

${spawnSnippet(hookArgv(PER_TURN_MIN_INTERVAL_SECONDS), "    ")}
  },
})

${exportStatement}
`;
}

function defaultPath(): string {
  return join(xdgConfigHome(), "opencode", "plugin", `${PLUGIN_BASENAME}.ts`);
}

function installOpencodeHook(settingsPath: string = defaultPath()): string {
  // OpenCode calls every top-level export as a plugin factory, so this file must
  // export exactly one thing and that thing must be callable.
  return installOwnedFile(settingsPath, idlePluginSource("export const CcusageHubSync = createPlugin"))
    .message;
}

export const opencode: Platform = {
  id: "opencode",
  label: "OpenCode",
  installHook: installOpencodeHook,
};

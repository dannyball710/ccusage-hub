import os from "node:os";
import { join } from "node:path";
import { GENERATED_HEADER, installOwnedFile, PLUGIN_BASENAME, spawnSnippet } from "./plugin-file.js";
import { hookArgv, PER_TURN_MIN_INTERVAL_SECONDS, type Platform } from "./types.js";

// Amp auto-loads plugins from its plugins dir; there is no `amp.plugins` config
// key and no `amp plugins add` CLI, so the file drop is the whole install.
//
// Amp's manual is right that there is no session.end event: agent.end fires once
// per turn, hence the throttled command.
function defaultPath(): string {
  // Amp documents this exact path, including %USERPROFILE%\.config\amp on
  // Windows. Unlike OpenCode/Kilo there is no evidence Amp reads
  // XDG_CONFIG_HOME, so we do not honour it here rather than guess a location
  // Amp may never scan.
  return join(os.homedir(), ".config", "amp", "plugins", `${PLUGIN_BASENAME}.ts`);
}

function pluginSource(): string {
  // @ampcode/plugin is types-only (zero runtime JS) and `import type` is erased,
  // so this single file needs no install step of its own.
  return `${GENERATED_HEADER}import type { PluginAPI } from "@ampcode/plugin"
import { spawn } from "node:child_process"

export default function (amp: PluginAPI) {
  amp.on("agent.end", () => {
${spawnSnippet(hookArgv(PER_TURN_MIN_INTERVAL_SECONDS), "    ")}
    // Returns void deliberately: returning {action: "continue"} would make Amp
    // start a follow-up turn.
  })
}
`;
}

function installAmpHook(settingsPath: string = defaultPath()): string {
  const result = installOwnedFile(settingsPath, pluginSource());
  if (!result.changed) return result.message;
  // Amp only scans the plugins dir at startup, so a running session needs a
  // nudge -- otherwise the user sees "installed" and no syncs until they happen
  // to restart.
  return `${result.message}; run Amp's "plugins: reload" action or restart Amp to load it`;
}

export const amp: Platform = {
  id: "amp",
  label: "Amp",
  installHook: installAmpHook,
};

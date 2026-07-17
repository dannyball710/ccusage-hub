import os from "node:os";
import { join } from "node:path";
import { GENERATED_HEADER, installOwnedFile, PLUGIN_BASENAME, spawnSnippet } from "./plugin-file.js";
import { hookArgv, type Platform } from "./types.js";

// pi-agent runs discoverAndLoadExtensions() unconditionally at startup, so a
// file in the extensions dir is the whole install -- no config, no CLI.
//
// This is the only platform here with a genuine once-per-session event, so it
// gets the unthrottled command: session_shutdown fires exactly as often as we
// want to sync. It is awaited before process.exit() with no timeout, which is
// precisely why the spawn must be detached and never awaited.
//
// pi's own killTrackedDetachedChildren() only kills PIDs it registered itself,
// so our child survives pi's shutdown rather than being reaped with it.
function defaultPath(): string {
  // Under HOME on every platform (os.homedir()), never AppData.
  const base = process.env.PI_CODING_AGENT_DIR || join(os.homedir(), ".pi", "agent");
  return join(base, "extensions", `${PLUGIN_BASENAME}.ts`);
}

function extensionSource(): string {
  // `import type` is fully erased at runtime, so the extension needs no runtime
  // dependency on the pi package -- a single-file drop is enough.
  return `${GENERATED_HEADER}import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { spawn } from "node:child_process"

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", () => {
${spawnSnippet(hookArgv(), "    ")}
  })
}
`;
}

function installPiHook(settingsPath: string = defaultPath()): string {
  return installOwnedFile(settingsPath, extensionSource()).message;
}

export const pi: Platform = {
  id: "pi",
  label: "pi-agent",
  installHook: installPiHook,
};

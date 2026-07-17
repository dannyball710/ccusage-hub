import { amp } from "./amp.js";
import { claude } from "./claude.js";
import { codebuff } from "./codebuff.js";
import { codex } from "./codex.js";
import { copilot } from "./copilot.js";
import { droid } from "./droid.js";
import { gemini } from "./gemini.js";
import { goose } from "./goose.js";
import { hermes } from "./hermes.js";
import { kilo } from "./kilo.js";
import { kimi } from "./kimi.js";
import { openclaw } from "./openclaw.js";
import { opencode } from "./opencode.js";
import { pi } from "./pi.js";
import { qwen } from "./qwen.js";
import type { Platform } from "./types.js";

export { HOOK_COMMAND, type Platform } from "./types.js";

// Ids and labels match ccusage's own agent list. Platforms without installHook
// have no usable session-end mechanism; each file states why.
export const PLATFORMS: Platform[] = [
  claude,
  codex,
  opencode,
  amp,
  droid,
  codebuff,
  hermes,
  pi,
  goose,
  kilo,
  copilot,
  gemini,
  kimi,
  qwen,
  openclaw,
];

export function getPlatform(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

// Values accepted by --editor; "none" writes config only, skipping any hook.
export const EDITOR_IDS = [...PLATFORMS.map((p) => p.id), "none"];

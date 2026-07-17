import { readFileSync, writeFileSync } from "node:fs";
import { configPath } from "./config.js";

interface State {
  lastSyncAt?: number; // epoch ms of the last sync that actually ran ccusage
}

function isState(v: unknown): v is State {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  if ("lastSyncAt" in v && v.lastSyncAt !== undefined && typeof v.lastSyncAt !== "number") {
    return false;
  }
  return true;
}

// Sits beside the config rather than inside it: the config is user-authored and
// hand-editable, this is ours and churns on every sync. Deriving it from
// configPath() means CCUSAGE_HUB_CONFIG keeps tests isolated for free.
export function statePath(): string {
  return `${configPath().replace(/\.json$/i, "")}.state.json`;
}

// A missing, unreadable or corrupt state file means "never synced": fail open
// toward syncing. A skipped sync loses data; a redundant one costs seconds.
export function readLastSyncAt(): number | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath(), "utf8"));
    if (!isState(parsed) || parsed.lastSyncAt === undefined) return null;
    return parsed.lastSyncAt;
  } catch {
    return null;
  }
}

// Best effort: an unwritable state file must never fail the sync that just
// succeeded, and must never break --quiet's exit-0 invariant. The cost of
// failing here is only that the next run syncs earlier than it needed to.
export function writeLastSyncAt(at: number): void {
  try {
    writeFileSync(statePath(), JSON.stringify({ lastSyncAt: at }, null, 2) + "\n");
  } catch {
    // Intentionally ignored -- see above.
  }
}

import { readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { endpointError } from "./endpoint.js";

export interface Config {
  endpoint: string;
  token: string;
  machineName?: string;
  sinceDays?: number;
}

function isConfig(v: unknown): v is Config {
  if (typeof v !== "object" || v === null) return false;
  // A hand-edited endpoint must satisfy the same rules as one from init.
  if (!("endpoint" in v) || typeof v.endpoint !== "string") return false;
  if (endpointError(v.endpoint) !== null) return false;
  if (!("token" in v) || typeof v.token !== "string" || !v.token) return false;
  if ("machineName" in v && v.machineName !== undefined && typeof v.machineName !== "string") {
    return false;
  }
  if ("sinceDays" in v && v.sinceDays !== undefined && typeof v.sinceDays !== "number") {
    return false;
  }
  return true;
}

// CCUSAGE_HUB_CONFIG overrides the config path (used for testing).
export function configPath(): string {
  return process.env.CCUSAGE_HUB_CONFIG || join(os.homedir(), ".ccusage-hub.json");
}

export function loadConfig(): Config | null {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const cfg: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
    return isConfig(cfg) ? cfg : null;
  } catch {
    return null;
  }
}

// Custom device name is optional; fall back to hostname at sync time.
export function resolveMachine(cfg: Config): string {
  const name = cfg.machineName?.trim();
  return name ? name : os.hostname();
}

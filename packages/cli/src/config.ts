import { readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

export interface Config {
  endpoint: string;
  token: string;
  machineName?: string;
  sinceDays?: number;
}

// CCUSAGE_CLOUD_CONFIG overrides the config path (used for testing).
export function configPath(): string {
  return process.env.CCUSAGE_CLOUD_CONFIG || join(os.homedir(), ".ccusage-cloud.json");
}

export function loadConfig(): Config | null {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const cfg = JSON.parse(raw.replace(/^\uFEFF/, "")) as unknown;
    if (typeof cfg !== "object" || cfg === null) return null;
    const c = cfg as Record<string, unknown>;
    const { endpoint, token, machineName, sinceDays } = c;
    if (typeof endpoint !== "string" || !endpoint) return null;
    if (typeof token !== "string" || !token) return null;
    if (machineName !== undefined && typeof machineName !== "string") return null;
    if (sinceDays !== undefined && typeof sinceDays !== "number") return null;
    return { endpoint, token, machineName, sinceDays };
  } catch {
    return null;
  }
}

// Custom device name is optional; fall back to hostname at sync time.
export function resolveMachine(cfg: Config): string {
  const name = cfg.machineName?.trim();
  return name ? name : os.hostname();
}

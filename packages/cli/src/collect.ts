import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { isDailyJson, parseDailyJson, type DailyJson, type UsageRow } from "./daily.js";
import { errnoCode } from "./errors.js";

export type { UsageRow } from "./daily.js";

interface BinMap {
  [name: string]: string;
}

function isBinMap(v: unknown): v is BinMap {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const values: unknown[] = Object.values(v);
  return values.every((x) => typeof x === "string");
}

// package.json "bin" is either a single path or a name-to-path map.
function packageBin(pkg: unknown): string | undefined {
  if (typeof pkg !== "object" || pkg === null || !("bin" in pkg)) return undefined;
  const bin = pkg.bin;
  if (typeof bin === "string") return bin;
  if (!isBinMap(bin)) return undefined;
  return bin["ccusage"] ?? Object.values(bin)[0];
}

// Resolve the bundled ccusage cli.js without relying on shell shims.
function resolveCcusageCli(): string {
  const req = createRequire(__filename);
  const pkgPath = req.resolve("ccusage/package.json");
  const pkgDir = dirname(pkgPath);
  const pkg: unknown = req("ccusage/package.json");
  const binRel = packageBin(pkg);
  if (!binRel) throw new Error("Cannot locate ccusage bin in its package.json");
  return join(pkgDir, binRel);
}

function sinceDate(sinceDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - sinceDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function runCcusage(
  cliJs: string,
  since: string,
  offline: boolean,
): { ok: boolean; json?: DailyJson; timedOut?: boolean } {
  const args = [cliJs, "daily", "--json", "--by-agent", "--since", since];
  if (offline) args.push("--offline");
  const res = spawnSync(process.execPath, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const timedOut = errnoCode(res.error) === "ETIMEDOUT";
  if (res.status !== 0 || !res.stdout) return { ok: false, timedOut };
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    return { ok: false };
  }
  if (!isDailyJson(parsed)) return { ok: false };
  return { ok: true, json: parsed };
}

export function collect(sinceDays = 7): UsageRow[] {
  const cliJs = resolveCcusageCli();
  const since = sinceDate(sinceDays);

  // Retry once without --offline if the offline run fails (pricing cache may be
  // cold) — but not on a timeout, to keep the hook's worst case bounded.
  let out = runCcusage(cliJs, since, true);
  if (!out.ok && !out.timedOut) out = runCcusage(cliJs, since, false);
  if (!out.ok || !out.json) {
    throw new Error(
      out.timedOut ? "ccusage timed out" : "ccusage failed to produce parseable output",
    );
  }

  return parseDailyJson(out.json);
}

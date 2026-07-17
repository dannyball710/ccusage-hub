import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export interface UsageRow {
  agent: string;
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

interface DailyJson {
  daily?: Array<{
    period?: string;
    agents?: Array<{
      agent?: string;
      modelBreakdowns?: Array<{
        modelName?: string;
        inputTokens?: number;
        outputTokens?: number;
        cacheCreationTokens?: number;
        cacheReadTokens?: number;
        cost?: number;
      }>;
    }>;
  }>;
}

// Resolve the bundled ccusage cli.js without relying on shell shims.
function resolveCcusageCli(): string {
  const req = createRequire(__filename);
  const pkgPath = req.resolve("ccusage/package.json");
  const pkgDir = dirname(pkgPath);
  const pkg = req("ccusage/package.json") as { bin?: string | Record<string, string> };
  let binRel: string | undefined;
  if (typeof pkg.bin === "string") binRel = pkg.bin;
  else if (pkg.bin) binRel = pkg.bin.ccusage ?? Object.values(pkg.bin)[0];
  if (!binRel) throw new Error("Cannot locate ccusage bin in its package.json");
  return join(pkgDir, binRel);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
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
  const timedOut = (res.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  if (res.status !== 0 || !res.stdout) return { ok: false, timedOut };
  try {
    return { ok: true, json: JSON.parse(res.stdout) as DailyJson };
  } catch {
    return { ok: false };
  }
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

  const rows: UsageRow[] = [];
  for (const day of out.json.daily ?? []) {
    const date = day.period;
    if (!date) continue;
    for (const a of day.agents ?? []) {
      const agent = a.agent;
      if (!agent) continue;
      for (const b of a.modelBreakdowns ?? []) {
        if (!b.modelName) continue;
        rows.push({
          agent,
          date,
          model: b.modelName,
          inputTokens: num(b.inputTokens),
          outputTokens: num(b.outputTokens),
          cacheCreationTokens: num(b.cacheCreationTokens),
          cacheReadTokens: num(b.cacheReadTokens),
          costUsd: num(b.cost),
        });
      }
    }
  }
  return rows;
}

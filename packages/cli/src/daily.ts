// Shape of `ccusage daily --json --by-agent` output and its flattening into
// upload rows.

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

export interface ModelBreakdown {
  modelName?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cost?: number;
}

export interface DayAgent {
  agent?: string;
  modelBreakdowns?: ModelBreakdown[];
}

export interface Day {
  period?: string;
  agents?: DayAgent[];
}

export interface DailyJson {
  daily?: Day[];
}

function isModelBreakdown(v: unknown): v is ModelBreakdown {
  if (typeof v !== "object" || v === null) return false;
  if ("modelName" in v && v.modelName !== undefined && typeof v.modelName !== "string") {
    return false;
  }
  if ("inputTokens" in v && v.inputTokens !== undefined && typeof v.inputTokens !== "number") {
    return false;
  }
  if ("outputTokens" in v && v.outputTokens !== undefined && typeof v.outputTokens !== "number") {
    return false;
  }
  if (
    "cacheCreationTokens" in v &&
    v.cacheCreationTokens !== undefined &&
    typeof v.cacheCreationTokens !== "number"
  ) {
    return false;
  }
  if (
    "cacheReadTokens" in v &&
    v.cacheReadTokens !== undefined &&
    typeof v.cacheReadTokens !== "number"
  ) {
    return false;
  }
  if ("cost" in v && v.cost !== undefined && typeof v.cost !== "number") return false;
  return true;
}

function isDayAgent(v: unknown): v is DayAgent {
  if (typeof v !== "object" || v === null) return false;
  if ("agent" in v && v.agent !== undefined && typeof v.agent !== "string") return false;
  if ("modelBreakdowns" in v && v.modelBreakdowns !== undefined) {
    if (!Array.isArray(v.modelBreakdowns)) return false;
    if (!v.modelBreakdowns.every(isModelBreakdown)) return false;
  }
  return true;
}

function isDay(v: unknown): v is Day {
  if (typeof v !== "object" || v === null) return false;
  if ("period" in v && v.period !== undefined && typeof v.period !== "string") return false;
  if ("agents" in v && v.agents !== undefined) {
    if (!Array.isArray(v.agents)) return false;
    if (!v.agents.every(isDayAgent)) return false;
  }
  return true;
}

export function isDailyJson(v: unknown): v is DailyJson {
  if (typeof v !== "object" || v === null) return false;
  if ("daily" in v && v.daily !== undefined) {
    if (!Array.isArray(v.daily)) return false;
    if (!v.daily.every(isDay)) return false;
  }
  return true;
}

function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function parseDailyJson(json: DailyJson): UsageRow[] {
  const rows: UsageRow[] = [];
  for (const day of json.daily ?? []) {
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

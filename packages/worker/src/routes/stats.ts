import { Hono } from "hono";
import { sessionAuth } from "../auth";
import { isValidDateStr, METRIC_COLUMNS, type AppEnv } from "../types";

type GroupBy = "machine" | "agent" | "model";

// Allowlist: maps groupBy param to a real column. Never interpolate user input.
const GROUP_BY_COLUMNS: { [K in GroupBy]: string } = {
  machine: "machine",
  agent: "agent",
  model: "model",
};

function isGroupBy(v: string): v is GroupBy {
  return v === "machine" || v === "agent" || v === "model";
}

function utcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const statsRoutes = new Hono<AppEnv>();

statsRoutes.get("/api/stats", sessionAuth, async (c) => {
  const today = new Date();
  const defaultTo = utcDateStr(today);
  const defaultFrom = utcDateStr(new Date(today.getTime() - 29 * 86400000));

  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");
  const from = fromParam && isValidDateStr(fromParam) ? fromParam : defaultFrom;
  const to = toParam && isValidDateStr(toParam) ? toParam : defaultTo;

  // Unknown groupBy falls back to the default dimension (machine).
  const groupByParam = c.req.query("groupBy") ?? "machine";
  const dim = isGroupBy(groupByParam) ? GROUP_BY_COLUMNS[groupByParam] : "machine";

  const sums = METRIC_COLUMNS.map((col) => `SUM(${col}) AS ${col}`).join(", ");

  const rowsResult = await c.env.DB.prepare(
    `SELECT date, ${dim} AS key, ${sums}
       FROM usage_daily
      WHERE date BETWEEN ? AND ?
      GROUP BY date, ${dim}
      ORDER BY date, key`
  )
    .bind(from, to)
    .all<{
      date: string;
      key: string;
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
      cost_usd: number;
    }>();

  const rows = rowsResult.results.map((r) => ({
    date: r.date,
    key: r.key,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    cacheCreationTokens: r.cache_creation_tokens ?? 0,
    cacheReadTokens: r.cache_read_tokens ?? 0,
    costUsd: r.cost_usd ?? 0,
  }));

  const totalsRow = await c.env.DB.prepare(
    `SELECT ${sums}, COUNT(DISTINCT machine) AS machines
       FROM usage_daily
      WHERE date BETWEEN ? AND ?`
  )
    .bind(from, to)
    .first<{
      input_tokens: number | null;
      output_tokens: number | null;
      cache_creation_tokens: number | null;
      cache_read_tokens: number | null;
      cost_usd: number | null;
      machines: number;
    }>();

  const totals = {
    inputTokens: totalsRow?.input_tokens ?? 0,
    outputTokens: totalsRow?.output_tokens ?? 0,
    cacheCreationTokens: totalsRow?.cache_creation_tokens ?? 0,
    cacheReadTokens: totalsRow?.cache_read_tokens ?? 0,
    costUsd: totalsRow?.cost_usd ?? 0,
    machines: totalsRow?.machines ?? 0,
  };

  return c.json({ ok: true, rows, totals });
});

export default statsRoutes;

import { Hono } from "hono";
import { apiKeyAuth } from "../auth";
import { DATE_RE, type AppEnv } from "../types";

const USAGE_BATCH_SIZE = 100; // rows per D1 batch(); caps bound params per call

function isNonNegNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

type UsageRow = {
  agent: string;
  date: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
};

type RowCheck = { ok: true; row: UsageRow } | { ok: false; error: string };

// Structural narrowing per field, no casts. A boolean type predicate cannot
// report which field failed, and the per-field error messages are part of the
// API contract, so this returns the narrowed row or the exact error instead.
function checkUsageRow(v: unknown, i: number): RowCheck {
  if (typeof v !== "object" || v === null) {
    return { ok: false, error: `row ${i}: must be an object` };
  }
  if (!("agent" in v) || typeof v.agent !== "string" || v.agent.length === 0) {
    return { ok: false, error: `row ${i}: agent must be a non-empty string` };
  }
  if (!("date" in v) || typeof v.date !== "string" || !DATE_RE.test(v.date)) {
    return { ok: false, error: `row ${i}: date must be YYYY-MM-DD` };
  }
  if (!("model" in v) || typeof v.model !== "string" || v.model.length === 0) {
    return { ok: false, error: `row ${i}: model must be a non-empty string` };
  }
  if (
    !("inputTokens" in v) ||
    !isNonNegNumber(v.inputTokens) ||
    !("outputTokens" in v) ||
    !isNonNegNumber(v.outputTokens) ||
    !("cacheCreationTokens" in v) ||
    !isNonNegNumber(v.cacheCreationTokens) ||
    !("cacheReadTokens" in v) ||
    !isNonNegNumber(v.cacheReadTokens)
  ) {
    return { ok: false, error: `row ${i}: token fields must be non-negative numbers` };
  }
  if (!("costUsd" in v) || !isNonNegNumber(v.costUsd)) {
    return { ok: false, error: `row ${i}: costUsd must be a non-negative number` };
  }
  return {
    ok: true,
    row: {
      agent: v.agent,
      date: v.date,
      model: v.model,
      inputTokens: v.inputTokens,
      outputTokens: v.outputTokens,
      cacheCreationTokens: v.cacheCreationTokens,
      cacheReadTokens: v.cacheReadTokens,
      costUsd: v.costUsd,
    },
  };
}

const usageRoutes = new Hono<AppEnv>();

usageRoutes.post("/api/usage", apiKeyAuth, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return c.json({ ok: false, error: "body must be an object" }, 400);
  }
  if (!("machine" in body) || typeof body.machine !== "string" || body.machine.length === 0) {
    return c.json({ ok: false, error: "machine must be a non-empty string" }, 400);
  }
  if (!("rows" in body) || !Array.isArray(body.rows)) {
    return c.json({ ok: false, error: "rows must be an array" }, 400);
  }
  const machine = body.machine;
  const rows: unknown[] = body.rows;

  if (rows.length > 2000) {
    return c.json({ ok: false, error: "rows exceeds max of 2000" }, 400);
  }
  if (rows.length === 0) {
    return c.json({ ok: true, upserted: 0 });
  }

  const updatedAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  const stmt = c.env.DB.prepare(
    `INSERT INTO usage_daily
       (machine, agent, date, model,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(machine, agent, date, model) DO UPDATE SET
       input_tokens = excluded.input_tokens,
       output_tokens = excluded.output_tokens,
       cache_creation_tokens = excluded.cache_creation_tokens,
       cache_read_tokens = excluded.cache_read_tokens,
       cost_usd = excluded.cost_usd,
       updated_at = excluded.updated_at`
  );

  for (let i = 0; i < rows.length; i++) {
    const checked = checkUsageRow(rows[i], i);
    if (!checked.ok) {
      return c.json({ ok: false, error: checked.error }, 400);
    }
    const r = checked.row;
    statements.push(
      stmt.bind(
        machine,
        r.agent,
        r.date,
        r.model,
        r.inputTokens,
        r.outputTokens,
        r.cacheCreationTokens,
        r.cacheReadTokens,
        r.costUsd,
        updatedAt
      )
    );
  }

  // Chunk into batches so a large upload stays under D1's per-call statement/param
  // limits. Batches run sequentially; a failure surfaces as 500.
  let upserted = 0;
  try {
    for (let i = 0; i < statements.length; i += USAGE_BATCH_SIZE) {
      const chunk = statements.slice(i, i + USAGE_BATCH_SIZE);
      await c.env.DB.batch(chunk);
      upserted += chunk.length;
    }
  } catch {
    return c.json({ ok: false, error: "database error during upsert" }, 500);
  }
  return c.json({ ok: true, upserted });
});

export default usageRoutes;

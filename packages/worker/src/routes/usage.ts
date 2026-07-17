import { Hono } from "hono";
import { apiKeyAuth } from "../auth";
import { isValidDateStr, type AppEnv } from "../types";

const USAGE_BATCH_SIZE = 100; // rows per D1 batch(); caps bound params per call

function isNonNegNumber(v: unknown): v is number {
  // Bounded to MAX_SAFE_INTEGER so summed metrics can never reach Infinity
  // (which `?? 0` in stats would silently turn into 0).
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
}

// Allowlist matches the dashboard's device-name filter (init-command.js) and
// the CLI's hostname-derived names.
const IDENT_RE = /^[A-Za-z0-9._ -]+$/;
// The charset above still admits these, and as object keys in a grouping map
// they enable prototype pollution downstream — reject them outright.
const RESERVED_IDENTS = ["__proto__", "constructor", "prototype"];

// Returns the validation error suffix for a machine/agent/model value, or null.
function identError(v: string): string | null {
  if (v.length > 200) return "too long (max 200)";
  if (!IDENT_RE.test(v)) return "contains invalid characters";
  if (RESERVED_IDENTS.includes(v)) return "is a reserved name";
  return null;
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
  const agentErr = identError(v.agent);
  if (agentErr !== null) {
    return { ok: false, error: `row ${i}: agent ${agentErr}` };
  }
  if (!("date" in v) || typeof v.date !== "string" || !isValidDateStr(v.date)) {
    return { ok: false, error: `row ${i}: date must be YYYY-MM-DD` };
  }
  if (!("model" in v) || typeof v.model !== "string" || v.model.length === 0) {
    return { ok: false, error: `row ${i}: model must be a non-empty string` };
  }
  const modelErr = identError(v.model);
  if (modelErr !== null) {
    return { ok: false, error: `row ${i}: model ${modelErr}` };
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
  const machineErr = identError(body.machine);
  if (machineErr !== null) {
    return c.json({ ok: false, error: `machine ${machineErr}` }, 400);
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
  } catch (err) {
    console.error(err); // keep the real error visible in Workers logs / wrangler tail
    return c.json({ ok: false, error: "database error during upsert" }, 500);
  }
  return c.json({ ok: true, upserted });
});

export default usageRoutes;

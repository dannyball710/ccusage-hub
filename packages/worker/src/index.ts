import { Hono, type MiddlewareHandler } from "hono";

type Bindings = {
  DB: D1Database;
};

type Variables = {
  // SHA-256 hex of the presented session token; set by sessionAuth for logout.
  sessionTokenHash: string;
};

// Metric columns shared by upsert and stats aggregation.
const METRIC_COLUMNS = [
  "input_tokens",
  "output_tokens",
  "cache_creation_tokens",
  "cache_read_tokens",
  "cost_usd",
] as const;

// Allowlist: maps groupBy param to a real column. Never interpolate user input.
const GROUP_BY_COLUMNS: Record<string, string> = {
  machine: "machine",
  agent: "agent",
  model: "model",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PBKDF2_ITERATIONS = 100000;
const SESSION_TTL_MS = 30 * 86400000; // 30 days
const ADMIN_PASSWORD_KEY = "admin_password";
const USAGE_BATCH_SIZE = 100; // rows per D1 batch(); caps bound params per call

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Uniform JSON for unhandled errors (e.g. D1 exceptions) instead of Hono's
// default plain-text "Internal Server Error".
app.onError((err, c) => {
  console.error(err); // keep the real error visible in Workers logs / wrangler tail
  return c.json({ ok: false, error: "internal error" }, 500);
});

// crypto helpers (WebCrypto)

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

// Random opaque token: <prefix> + 64 hex chars (32 bytes).
function generateToken(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return prefix + bytesToHex(bytes);
}

// Constant-time string comparison to avoid leaking secrets via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2B64(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bytesToB64(new Uint8Array(bits));
}

function bearer(c: { req: { header: (n: string) => string | undefined } }): string {
  const header = c.req.header("Authorization") ?? "";
  const prefix = "Bearer ";
  return header.startsWith(prefix) ? header.slice(prefix.length) : "";
}

// session / password storage

type AdminPassword = { saltB64: string; hashB64: string; iterations: number };

async function getAdminPassword(db: D1Database): Promise<AdminPassword | null> {
  const row = await db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .bind(ADMIN_PASSWORD_KEY)
    .first<{ value: string }>();
  return row ? (JSON.parse(row.value) as AdminPassword) : null;
}

async function createSession(db: D1Database): Promise<string> {
  const token = generateToken("ses_");
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await db
    .prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
    .bind(tokenHash, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString())
    .run();
  return token;
}

// auth middleware

// Requires a valid, unexpired admin session (ses_...). Used by dashboard routes.
const sessionAuth: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const token = bearer(c);
  if (!token.startsWith("ses_")) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first<{ expires_at: string }>();
  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  c.set("sessionTokenHash", tokenHash);
  await next();
};

// Requires a valid, non-revoked API key (ccu_...). Used by the upload route.
const apiKeyAuth: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (c, next) => {
  const key = bearer(c);
  if (!key.startsWith("ccu_")) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  const keyHash = await sha256Hex(key);
  const row = await c.env.DB.prepare("SELECT id, revoked FROM api_keys WHERE key_hash = ?")
    .bind(keyHash)
    .first<{ id: string; revoked: number }>();
  if (!row || row.revoked) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  // Fire-and-forget: don't block the upload response on the last_used_at write.
  c.executionCtx.waitUntil(
    c.env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), row.id)
      .run()
  );
  await next();
};

// public routes

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/setup-status", async (c) => {
  const admin = await getAdminPassword(c.env.DB);
  return c.json({ ok: true, needsSetup: admin === null });
});

app.post("/api/setup", async (c) => {
  if (await getAdminPassword(c.env.DB)) {
    return c.json({ ok: false, error: "already set up" }, 409);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }
  const password = (body as { password?: unknown })?.password;
  if (typeof password !== "string" || password.length < 8) {
    return c.json({ ok: false, error: "password must be at least 8 characters" }, 400);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashB64 = await pbkdf2B64(password, salt, PBKDF2_ITERATIONS);
  const record: AdminPassword = {
    saltB64: bytesToB64(salt),
    hashB64,
    iterations: PBKDF2_ITERATIONS,
  };
  // Atomic insert closes the SELECT-then-INSERT race: a concurrent setup that
  // won the insert leaves changes=0 here, so we return 409 without a session.
  const result = await c.env.DB.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING"
  )
    .bind(ADMIN_PASSWORD_KEY, JSON.stringify(record))
    .run();
  if (result.meta.changes === 0) {
    return c.json({ ok: false, error: "already set up" }, 409);
  }

  const session = await createSession(c.env.DB);
  return c.json({ ok: true, session });
});

app.post("/api/login", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }
  const password = (body as { password?: unknown })?.password;
  const admin = await getAdminPassword(c.env.DB);

  const fail = async () => {
    // Slow down failures to blunt password guessing.
    await new Promise((r) => setTimeout(r, 200));
    return c.json({ ok: false, error: "invalid password" }, 401);
  };

  if (!admin || typeof password !== "string") return fail();

  const candidate = await pbkdf2B64(password, b64ToBytes(admin.saltB64), admin.iterations);
  if (!timingSafeEqual(candidate, admin.hashB64)) return fail();

  const session = await createSession(c.env.DB);
  return c.json({ ok: true, session });
});

// session-authed routes

app.post("/api/logout", sessionAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(c.get("sessionTokenHash"))
    .run();
  return c.json({ ok: true });
});

app.get("/api/keys", sessionAuth, async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT id, name, created_at, last_used_at, revoked FROM api_keys ORDER BY created_at"
  ).all<{
    id: string;
    name: string;
    created_at: string;
    last_used_at: string | null;
    revoked: number;
  }>();
  const keys = result.results.map((k) => ({
    id: k.id,
    name: k.name,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
    revoked: k.revoked === 1,
  }));
  return c.json({ ok: true, keys });
});

app.post("/api/keys", sessionAuth, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }
  const name = (body as { name?: unknown })?.name;
  if (typeof name !== "string" || name.length === 0) {
    return c.json({ ok: false, error: "name must be a non-empty string" }, 400);
  }

  const id = crypto.randomUUID();
  const key = generateToken("ccu_");
  const keyHash = await sha256Hex(key);
  await c.env.DB.prepare(
    "INSERT INTO api_keys (id, name, key_hash, created_at, last_used_at, revoked) VALUES (?, ?, ?, ?, NULL, 0)"
  )
    .bind(id, name, keyHash, new Date().toISOString())
    .run();

  // Full key is returned exactly once; only its hash is stored.
  return c.json({ ok: true, id, key });
});

app.delete("/api/keys/:id", sessionAuth, async (c) => {
  await c.env.DB.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

// POST /api/usage (API key auth)

function isNonNegNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

app.post("/api/usage", apiKeyAuth, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return c.json({ ok: false, error: "body must be an object" }, 400);
  }
  const { machine, rows } = body as { machine?: unknown; rows?: unknown };

  if (typeof machine !== "string" || machine.length === 0) {
    return c.json({ ok: false, error: "machine must be a non-empty string" }, 400);
  }
  if (!Array.isArray(rows)) {
    return c.json({ ok: false, error: "rows must be an array" }, 400);
  }
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
    const r = rows[i] as Record<string, unknown>;
    if (typeof r !== "object" || r === null) {
      return c.json({ ok: false, error: `row ${i}: must be an object` }, 400);
    }
    if (typeof r.agent !== "string" || r.agent.length === 0) {
      return c.json({ ok: false, error: `row ${i}: agent must be a non-empty string` }, 400);
    }
    if (typeof r.date !== "string" || !DATE_RE.test(r.date)) {
      return c.json({ ok: false, error: `row ${i}: date must be YYYY-MM-DD` }, 400);
    }
    if (typeof r.model !== "string" || r.model.length === 0) {
      return c.json({ ok: false, error: `row ${i}: model must be a non-empty string` }, 400);
    }
    if (
      !isNonNegNumber(r.inputTokens) ||
      !isNonNegNumber(r.outputTokens) ||
      !isNonNegNumber(r.cacheCreationTokens) ||
      !isNonNegNumber(r.cacheReadTokens)
    ) {
      return c.json({ ok: false, error: `row ${i}: token fields must be non-negative numbers` }, 400);
    }
    if (!isNonNegNumber(r.costUsd)) {
      return c.json({ ok: false, error: `row ${i}: costUsd must be a non-negative number` }, 400);
    }

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

// GET /api/stats (session auth)

function utcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

app.get("/api/stats", sessionAuth, async (c) => {
  const today = new Date();
  const defaultTo = utcDateStr(today);
  const defaultFrom = utcDateStr(new Date(today.getTime() - 29 * 86400000));

  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");
  const from = fromParam && DATE_RE.test(fromParam) ? fromParam : defaultFrom;
  const to = toParam && DATE_RE.test(toParam) ? toParam : defaultTo;

  // Unknown groupBy falls back to the default dimension (machine).
  const groupByParam = c.req.query("groupBy") ?? "machine";
  const dim = GROUP_BY_COLUMNS[groupByParam] ?? "machine";

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

export default app;

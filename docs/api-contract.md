# ccusage-hub API Contract

Shared contract between CLI (uploader), Worker (API), and Dashboard. Changes here require updating all three.

## Auth (v2)

Two credential types, both sent as `Authorization: Bearer <value>`:

- **API keys** (`ccu_` + 64 hex chars): used by CLI uploaders. Only valid on `POST /api/usage`.
  Created/revoked by the admin in the dashboard. Stored as SHA-256 hex in D1; full key shown once.
- **Admin sessions** (`ses_` + 64 hex chars): used by the dashboard. Valid on `/api/stats`,
  `/api/keys*`, `/api/logout`. Obtained via `/api/setup` (first run) or `/api/login`.
  Stored as SHA-256 hex in D1 with 30-day expiry.

Admin password: set once on first open. PBKDF2-SHA256 (WebCrypto, 100000 iterations,
16-byte random salt) stored in `meta` table under key `admin_password` as JSON
`{"saltB64","hashB64","iterations"}`.
No `API_TOKEN` Worker secret anymore.

### GET /api/setup-status — no auth
`200 {"ok":true,"needsSetup":true|false}` (`needsSetup` = admin password not yet set)

### POST /api/setup — no auth, only works while needsSetup
Body `{"password":"..."}` (min 8 chars). Sets admin password, creates session.
`200 {"ok":true,"session":"ses_..."}` | `409` if already set | `400` weak password.

### POST /api/login — no auth
Body `{"password":"..."}`. `200 {"ok":true,"session":"ses_..."}` | `401` wrong password
(constant-ish response time; add ~200ms sleep on failure).

### POST /api/logout — session auth
Deletes current session. `200 {"ok":true}`.

### API key management — session auth

- `GET /api/keys` → `{"ok":true,"keys":[{"id","name","createdAt","lastUsedAt","revoked"}]}`
- `POST /api/keys` body `{"name":"my-desktop"}` → `{"ok":true,"id":"...","key":"ccu_..."}`
  (full key returned ONCE, never retrievable again)
- `DELETE /api/keys/:id` → `{"ok":true}` (sets revoked=1; revoked keys rejected on upload)

## POST /api/usage — API key auth (`ccu_...`)

Upsert daily usage rows. Idempotent: rows overwrite by primary key (not accumulate),
because ccusage always reports full-day totals. Accepting a key updates its `last_used_at`.

Request body:

```json
{
  "machine": "my-desktop",
  "rows": [
    {
      "agent": "claude",
      "date": "2026-07-15",
      "model": "claude-opus-4-8",
      "inputTokens": 902,
      "outputTokens": 247849,
      "cacheCreationTokens": 1914866,
      "cacheReadTokens": 80496321,
      "costUsd": 65.397
    }
  ]
}
```

Constraints: `machine` non-empty string; `rows` max 2000; `date` is `YYYY-MM-DD`.

Response: `200 {"ok": true, "upserted": <n>}` | `400 {"ok": false, "error": "..."}` | `401`.

## GET /api/stats?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=machine|agent|model — session auth

Aggregated stats for charts. Always grouped by `(date, <groupBy dimension>)`.
Default range: last 30 days. Default groupBy: `machine`.

Response:

```json
{
  "ok": true,
  "rows": [
    {
      "date": "2026-07-15",
      "key": "my-desktop",
      "inputTokens": 902,
      "outputTokens": 247849,
      "cacheCreationTokens": 1914866,
      "cacheReadTokens": 80496321,
      "costUsd": 65.397
    }
  ],
  "totals": {
    "inputTokens": 902,
    "outputTokens": 247849,
    "cacheCreationTokens": 1914866,
    "cacheReadTokens": 80496321,
    "costUsd": 65.397,
    "machines": 2
  }
}
```

`key` = the value of the groupBy dimension. `totals.machines` = distinct machine count in range.

## GET /api/health

No auth. `200 {"ok": true}`.

## D1 schema

```sql
CREATE TABLE IF NOT EXISTS usage_daily (
  machine     TEXT NOT NULL,
  agent       TEXT NOT NULL,
  date        TEXT NOT NULL,
  model       TEXT NOT NULL,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cost_usd    REAL NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (machine, agent, date, model)
);
CREATE INDEX IF NOT EXISTS idx_usage_daily_date ON usage_daily(date);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL,            -- SHA-256 hex of full key
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,           -- SHA-256 hex of session token
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
```

## CLI init (non-interactive) — for the dashboard command generator

```
npx -y ccusage-hub@latest init --endpoint <workerUrl> --key <ccu_...> [--machine <name>] --editor <claude|codex|gemini|copilot|none> --yes
```

- `--yes`: no prompts; missing `--machine` → hostname fallback at sync time.
- `--editor claude`: installs the Claude Code SessionEnd hook into `~/.claude/settings.json`.
- any other `--editor` value: writes config only, no hook (upload still covers ALL agents'
  data because ccusage scans everything; those machines sync via Claude Code trigger or manual `sync`).
- The dashboard generates this command after creating an API key (key visible only at that moment).

## ccusage source format (v20, verified locally)

`ccusage daily --json --by-agent --since YYYYMMDD --offline` returns:

```json
{
  "daily": [
    {
      "period": "2026-07-15",
      "agents": [
        {
          "agent": "claude",
          "modelBreakdowns": [
            {
              "modelName": "claude-opus-4-8",
              "inputTokens": 902,
              "outputTokens": 247849,
              "cacheCreationTokens": 1914866,
              "cacheReadTokens": 80496321,
              "cost": 65.397
            }
          ]
        }
      ]
    }
  ],
  "totals": { }
}
```

Note: breakdown fields are `modelName` and `cost` (not `costUSD`). Agents with no data
simply don't appear in `agents[]`; a machine with no data at all returns `"daily": []`.

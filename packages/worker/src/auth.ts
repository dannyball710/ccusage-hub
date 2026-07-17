import type { MiddlewareHandler } from "hono";
import { generateToken, sha256Hex } from "./crypto";
import type { AppEnv } from "./types";

const SESSION_TTL_MS = 30 * 86400000; // 30 days
export const ADMIN_PASSWORD_KEY = "admin_password";

function bearer(c: { req: { header: (n: string) => string | undefined } }): string {
  const header = c.req.header("Authorization") ?? "";
  const prefix = "Bearer ";
  return header.startsWith(prefix) ? header.slice(prefix.length) : "";
}

// session / password storage

export type AdminPassword = { saltB64: string; hashB64: string; iterations: number };

function isAdminPassword(v: unknown): v is AdminPassword {
  return (
    typeof v === "object" &&
    v !== null &&
    "saltB64" in v &&
    typeof v.saltB64 === "string" &&
    "hashB64" in v &&
    typeof v.hashB64 === "string" &&
    "iterations" in v &&
    typeof v.iterations === "number"
  );
}

export async function getAdminPassword(db: D1Database): Promise<AdminPassword | null> {
  const row = await db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .bind(ADMIN_PASSWORD_KEY)
    .first<{ value: string }>();
  if (!row) return null;
  const parsed: unknown = JSON.parse(row.value);
  // Only /api/setup writes this value, so a mismatch means data corruption.
  // Throw (-> 500 via onError) rather than return null: corruption must not
  // silently reopen setup (needsSetup) or turn into a 401 on login.
  if (!isAdminPassword(parsed)) {
    throw new Error("corrupt admin_password record");
  }
  return parsed;
}

export async function createSession(db: D1Database): Promise<string> {
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
export const sessionAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = bearer(c);
  if (!token.startsWith("ses_")) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .first<{ expires_at: string }>();
  if (!row) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  // Fail closed: an unparseable expires_at (NaN) must count as expired, not
  // as a session that never expires.
  const exp = Date.parse(row.expires_at);
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    // Fire-and-forget: prune the expired row so the sessions table doesn't
    // grow unboundedly.
    c.executionCtx.waitUntil(
      c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run()
    );
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  c.set("sessionTokenHash", tokenHash);
  await next();
};

// Requires a valid, non-revoked API key (ccu_...). Used by the upload route.
export const apiKeyAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
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

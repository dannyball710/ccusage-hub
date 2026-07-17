import { Hono } from "hono";
import {
  ADMIN_PASSWORD_KEY,
  createSession,
  getAdminPassword,
  sessionAuth,
  type AdminPassword,
} from "../auth";
import { b64ToBytes, bytesToB64, pbkdf2B64, timingSafeEqual } from "../crypto";
import type { AppEnv } from "../types";

const PBKDF2_ITERATIONS = 100000;

function isPasswordPayload(v: unknown): v is { password: string } {
  return typeof v === "object" && v !== null && "password" in v && typeof v.password === "string";
}

const authRoutes = new Hono<AppEnv>();

authRoutes.get("/api/setup-status", async (c) => {
  const admin = await getAdminPassword(c.env.DB);
  return c.json({ ok: true, needsSetup: admin === null });
});

authRoutes.post("/api/setup", async (c) => {
  if (await getAdminPassword(c.env.DB)) {
    return c.json({ ok: false, error: "already set up" }, 409);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }
  if (!isPasswordPayload(body) || body.password.length < 8) {
    return c.json({ ok: false, error: "password must be at least 8 characters" }, 400);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashB64 = await pbkdf2B64(body.password, salt, PBKDF2_ITERATIONS);
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

authRoutes.post("/api/login", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }
  const admin = await getAdminPassword(c.env.DB);

  const fail = async () => {
    // Slow down failures to blunt password guessing.
    await new Promise((r) => setTimeout(r, 200));
    return c.json({ ok: false, error: "invalid password" }, 401);
  };

  if (!admin || !isPasswordPayload(body)) return fail();

  const candidate = await pbkdf2B64(body.password, b64ToBytes(admin.saltB64), admin.iterations);
  if (!timingSafeEqual(candidate, admin.hashB64)) return fail();

  const session = await createSession(c.env.DB);
  return c.json({ ok: true, session });
});

authRoutes.post("/api/logout", sessionAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(c.get("sessionTokenHash"))
    .run();
  return c.json({ ok: true });
});

export default authRoutes;

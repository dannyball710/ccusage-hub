import { Hono } from "hono";
import { sessionAuth } from "../auth";
import { generateToken, sha256Hex } from "../crypto";
import type { AppEnv } from "../types";

function isCreateKeyPayload(v: unknown): v is { name: string } {
  return typeof v === "object" && v !== null && "name" in v && typeof v.name === "string";
}

const keysRoutes = new Hono<AppEnv>();

keysRoutes.get("/api/keys", sessionAuth, async (c) => {
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

keysRoutes.post("/api/keys", sessionAuth, async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }
  if (!isCreateKeyPayload(body) || body.name.length === 0) {
    return c.json({ ok: false, error: "name must be a non-empty string" }, 400);
  }

  const id = crypto.randomUUID();
  const key = generateToken("ccu_");
  const keyHash = await sha256Hex(key);
  await c.env.DB.prepare(
    "INSERT INTO api_keys (id, name, key_hash, created_at, last_used_at, revoked) VALUES (?, ?, ?, ?, NULL, 0)"
  )
    .bind(id, body.name, keyHash, new Date().toISOString())
    .run();

  // Full key is returned exactly once; only its hash is stored.
  return c.json({ ok: true, id, key });
});

keysRoutes.delete("/api/keys/:id", sessionAuth, async (c) => {
  await c.env.DB.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?")
    .bind(c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

export default keysRoutes;

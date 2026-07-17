import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, createKey, json, postJson, setupAdmin } from "./helpers";

const validRow = {
  agent: "claude",
  date: "2026-07-01",
  model: "model-a",
  inputTokens: 1,
  outputTokens: 2,
  cacheCreationTokens: 3,
  cacheReadTokens: 4,
  costUsd: 0.5,
};

describe("API key management", () => {
  it("requires a session", async () => {
    expect((await call("/api/keys")).status).toBe(401);
    expect((await postJson("/api/keys", { name: "x" })).status).toBe(401);
    expect((await call("/api/keys/some-id", { method: "DELETE" })).status).toBe(401);
  });

  it("creates a key returning the full ccu_ key and an id", async () => {
    const session = await setupAdmin();
    const { id, key } = await createKey(session);
    expect(id.length).toBeGreaterThan(0);
    expect(key).toMatch(/^ccu_[0-9a-f]{64}$/);
  });

  it("rejects an empty name", async () => {
    const session = await setupAdmin();
    const res = await postJson("/api/keys", { name: "" }, session);
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ ok: false, error: "name must be a non-empty string" });
  });

  it("lists keys without exposing any key material", async () => {
    const session = await setupAdmin();
    const { id, key } = await createKey(session, "laptop");
    const res = await call("/api/keys", {}, session);
    expect(res.status).toBe(200);
    // The full key is shown once at creation; neither it nor its hash may be
    // retrievable afterwards.
    const text = await res.text();
    expect(text).not.toContain(key);
    expect(text).not.toContain("ccu_");
    expect(text).not.toContain("hash");
    expect(JSON.parse(text)).toEqual({
      ok: true,
      keys: [{ id, name: "laptop", createdAt: expect.any(String), lastUsedAt: null, revoked: false }],
    });
  });

  it("revokes a key so subsequent uploads are rejected", async () => {
    const session = await setupAdmin();
    const { id, key } = await createKey(session);
    expect((await postJson("/api/usage", { machine: "m", rows: [validRow] }, key)).status).toBe(200);
    const del = await call(`/api/keys/${id}`, { method: "DELETE" }, session);
    expect(del.status).toBe(200);
    expect(await json(del)).toEqual({ ok: true });
    expect((await postJson("/api/usage", { machine: "m", rows: [validRow] }, key)).status).toBe(401);
  });

  it("updates last_used_at when a key is accepted on upload", async () => {
    const session = await setupAdmin();
    const { id, key } = await createKey(session);
    const before = await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?")
      .bind(id)
      .first<{ last_used_at: string | null }>();
    expect(before?.last_used_at).toBeNull();
    expect((await postJson("/api/usage", { machine: "m", rows: [] }, key)).status).toBe(200);
    const after = await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?")
      .bind(id)
      .first<{ last_used_at: string | null }>();
    expect(after?.last_used_at).not.toBeNull();
  });
});

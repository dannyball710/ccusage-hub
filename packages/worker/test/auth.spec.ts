import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, json, postJson, setupAdmin } from "./helpers";

describe("GET /api/health", () => {
  it("returns ok without auth", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
  });
});

describe("setup flow", () => {
  it("reports needsSetup until the admin password is set", async () => {
    expect(await json(await call("/api/setup-status"))).toEqual({ ok: true, needsSetup: true });
    await setupAdmin();
    expect(await json(await call("/api/setup-status"))).toEqual({ ok: true, needsSetup: false });
  });

  it("rejects passwords shorter than 8 characters", async () => {
    const res = await postJson("/api/setup", { password: "short" });
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ ok: false, error: "password must be at least 8 characters" });
  });

  it("returns a ses_ session token on success", async () => {
    const session = await setupAdmin();
    expect(session).toMatch(/^ses_[0-9a-f]{64}$/);
  });

  it("returns 409 once the password is already set", async () => {
    await setupAdmin();
    const res = await postJson("/api/setup", { password: "another-password" });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ ok: false, error: "already set up" });
  });
});

describe("POST /api/login", () => {
  it("rejects a wrong password with 401", async () => {
    await setupAdmin("correct-password");
    const res = await postJson("/api/login", { password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ ok: false, error: "invalid password" });
  });

  it("returns a working session for the right password", async () => {
    await setupAdmin("correct-password");
    const res = await postJson("/api/login", { password: "correct-password" });
    expect(res.status).toBe(200);
    const data = await json(res);
    if (typeof data !== "object" || data === null || !("session" in data) || typeof data.session !== "string") {
      throw new Error("login did not return a session");
    }
    expect((await call("/api/stats", {}, data.session)).status).toBe(200);
  });
});

describe("POST /api/logout", () => {
  it("invalidates the session for subsequent requests", async () => {
    const session = await setupAdmin();
    expect((await call("/api/stats", {}, session)).status).toBe(200);
    const res = await call("/api/logout", { method: "POST" }, session);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
    expect((await call("/api/stats", {}, session)).status).toBe(401);
  });
});

describe("session auth", () => {
  it("rejects missing, malformed and unknown tokens on protected routes", async () => {
    await setupAdmin();
    expect((await call("/api/stats")).status).toBe(401);
    expect((await call("/api/stats", {}, "garbage")).status).toBe(401);
    expect((await call("/api/keys", {}, `ses_${"0".repeat(64)}`)).status).toBe(401);
  });

  it("rejects an expired session and prunes its row", async () => {
    const session = await setupAdmin();
    await env.DB.prepare("UPDATE sessions SET expires_at = ?").bind("2000-01-01T00:00:00.000Z").run();
    expect((await call("/api/stats", {}, session)).status).toBe(401);
    // The 401 also deletes the expired row (via waitUntil) so the sessions
    // table doesn't grow unboundedly.
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  // Only createSession writes expires_at, but if the value is ever corrupt,
  // Date.parse yields NaN and a naive `NaN <= now` check would grant a session
  // that never expires. Fail closed instead.
  it("rejects a session with a corrupt expires_at", async () => {
    const session = await setupAdmin();
    await env.DB.prepare("UPDATE sessions SET expires_at = ?").bind("not-a-date").run();
    expect((await call("/api/stats", {}, session)).status).toBe(401);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe("corrupt admin_password record", () => {
  // Only /api/setup writes this value; a corrupt record must surface as 500,
  // not silently reopen setup (needsSetup) or turn into a 401 on login.
  it("returns 500 instead of reopening setup or rejecting login as 401", async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('admin_password', ?)")
      .bind(JSON.stringify({ saltB64: "abc" }))
      .run();
    const status = await call("/api/setup-status");
    expect(status.status).toBe(500);
    expect(await json(status)).toEqual({ ok: false, error: "internal error" });
    expect((await postJson("/api/login", { password: "whatever-pass" })).status).toBe(500);
  });
});

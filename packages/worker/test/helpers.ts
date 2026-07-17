import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import app from "../src/index";

// Dispatches a request against the app with the test env and a fresh
// ExecutionContext, waiting for waitUntil work (e.g. last_used_at updates).
export async function call(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token !== undefined) headers.set("Authorization", `Bearer ${token}`);
  const ctx = createExecutionContext();
  const res = await app.request(path, { ...init, headers }, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export function postJson(path: string, body: unknown, token?: string): Promise<Response> {
  return call(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    token
  );
}

export async function json(res: Response): Promise<unknown> {
  return await res.json();
}

export async function setupAdmin(password = "test-password-123"): Promise<string> {
  const res = await postJson("/api/setup", { password });
  const data = await json(res);
  if (typeof data === "object" && data !== null && "session" in data && typeof data.session === "string") {
    return data.session;
  }
  throw new Error(`setup did not return a session (status ${res.status})`);
}

export async function createKey(session: string, name = "test-key"): Promise<{ id: string; key: string }> {
  const res = await postJson("/api/keys", { name }, session);
  const data = await json(res);
  if (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof data.id === "string" &&
    "key" in data &&
    typeof data.key === "string"
  ) {
    return { id: data.id, key: data.key };
  }
  throw new Error(`key creation did not return id and key (status ${res.status})`);
}

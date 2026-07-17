import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Vitest 4 pool-workers no longer undoes storage writes per test, so wipe all
// tables between tests to keep them independent.
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM usage_daily"),
    env.DB.prepare("DELETE FROM meta"),
    env.DB.prepare("DELETE FROM api_keys"),
    env.DB.prepare("DELETE FROM sessions"),
  ]);
});

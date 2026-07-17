import { Hono } from "hono";
import authRoutes from "./routes/auth";
import keysRoutes from "./routes/keys";
import statsRoutes from "./routes/stats";
import usageRoutes from "./routes/usage";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// Uniform JSON for unhandled errors (e.g. D1 exceptions) instead of Hono's
// default plain-text "Internal Server Error".
app.onError((err, c) => {
  console.error(err); // keep the real error visible in Workers logs / wrangler tail
  return c.json({ ok: false, error: "internal error" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/", authRoutes);
app.route("/", keysRoutes);
app.route("/", usageRoutes);
app.route("/", statsRoutes);

export default app;

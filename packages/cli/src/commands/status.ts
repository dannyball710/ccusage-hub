import { configPath, loadConfig, resolveMachine } from "../config.js";
import { apiUrl } from "../endpoint.js";
import { errorMessage } from "../errors.js";

// Fixed-width mask so the output does not leak the token's length; tokens too
// short to mask meaningfully are hidden entirely.
function maskToken(token: string): string {
  if (token.length <= 4) return "****";
  return `****${token.slice(-4)}`;
}

export async function cmdStatus(): Promise<number> {
  const cfg = loadConfig();
  if (!cfg) {
    process.stderr.write("ccusage-hub: no config found. Run: ccusage-hub init\n");
    return 1;
  }
  process.stdout.write(`Config:    ${configPath()}\n`);
  process.stdout.write(`Endpoint:  ${cfg.endpoint}\n`);
  process.stdout.write(`Token:     ${maskToken(cfg.token)}\n`);
  process.stdout.write(`Machine:   ${resolveMachine(cfg)}\n`);

  const url = apiUrl(cfg.endpoint, "/api/health");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    process.stdout.write(`Health:    ${res.ok ? "reachable" : "unreachable"} (HTTP ${res.status})\n`);
    return res.ok ? 0 : 1;
  } catch (err) {
    process.stdout.write(`Health:    unreachable (${errorMessage(err)})\n`);
    return 1;
  }
}

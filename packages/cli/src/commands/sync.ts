import type { Flags } from "../args.js";
import { collect, type UsageRow } from "../collect.js";
import { loadConfig, resolveMachine } from "../config.js";
import { errorMessage } from "../errors.js";
import { upload } from "../upload.js";

export async function cmdSync(flags: Flags): Promise<number> {
  const quiet = flags.bool.has("quiet");
  const dryRun = flags.bool.has("dry-run");
  const fail = (msg: string): number => {
    if (quiet) {
      process.stderr.write(`ccusage-hub: ${msg}\n`);
      return 0; // hook mode: never break session end
    }
    process.stderr.write(`ccusage-hub: ${msg}\n`);
    return 1;
  };

  const cfg = loadConfig();
  if (!cfg) return fail("no config found. Run: ccusage-hub init");

  let sinceDays: number;
  if (flags.value.has("since-days")) {
    const raw = (flags.value.get("since-days") ?? "").trim();
    if (raw === "") return fail("invalid --since-days"); // flag given without a value
    sinceDays = Number(raw);
  } else {
    sinceDays = cfg.sinceDays ?? 7;
  }
  if (!Number.isInteger(sinceDays) || sinceDays < 0) return fail("invalid --since-days");

  let rows: UsageRow[];
  try {
    rows = collect(sinceDays);
  } catch (err) {
    return fail(errorMessage(err));
  }

  if (rows.length === 0) {
    if (!quiet) process.stdout.write("No usage rows found; nothing to upload.\n");
    return 0;
  }

  if (dryRun) {
    if (!quiet) process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return 0;
  }

  try {
    const machine = resolveMachine(cfg);
    const result = await upload(cfg.endpoint, cfg.token, machine, rows);
    if (!quiet) {
      const dates = rows.map((r) => r.date).sort();
      process.stdout.write(
        `Uploaded ${rows.length} rows for "${machine}" (${dates[0]}..${dates[dates.length - 1]}), upserted ${result.upserted ?? "?"}.\n`,
      );
    }
    return 0;
  } catch (err) {
    return fail(errorMessage(err));
  }
}

import type { Flags } from "../args.js";
import { collect, type UsageRow } from "../collect.js";
import { loadConfig, resolveMachine } from "../config.js";
import { errorMessage } from "../errors.js";
import { readLastSyncAt, writeLastSyncAt } from "../state.js";
import { upload } from "../upload.js";

export async function cmdSync(flags: Flags): Promise<number> {
  const quiet = flags.bool.has("quiet");
  const dryRun = flags.bool.has("dry-run");
  const fail = (msg: string): number => {
    process.stderr.write(`ccusage-hub: ${msg}\n`);
    return quiet ? 0 : 1; // hook mode: never break session end
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

  // --min-interval makes per-turn hooks affordable: the agent still runs the
  // command every turn, but we only pay for a ccusage scan once per window.
  let minIntervalSec = 0;
  if (flags.value.has("min-interval")) {
    const raw = (flags.value.get("min-interval") ?? "").trim();
    if (raw === "") return fail("invalid --min-interval"); // flag given without a value
    minIntervalSec = Number(raw);
    if (!Number.isInteger(minIntervalSec) || minIntervalSec < 0) {
      return fail("invalid --min-interval");
    }
  }
  // --dry-run is an explicit manual debug invocation; never throttle it.
  if (minIntervalSec > 0 && !dryRun) {
    const last = readLastSyncAt();
    const ageMs = last === null ? null : Date.now() - last;
    // A negative age means the stored time is in the future (clock change);
    // treat it as stale so a bad timestamp cannot wedge sync forever.
    if (ageMs !== null && ageMs >= 0 && ageMs < minIntervalSec * 1000) {
      if (!quiet) {
        process.stdout.write(
          `Skipped: synced ${Math.round(ageMs / 1000)}s ago (--min-interval ${minIntervalSec}).\n`,
        );
      }
      return 0; // a throttled skip is a success, not an error
    }
  }

  let rows: UsageRow[];
  try {
    rows = collect(sinceDays);
  } catch (err) {
    return fail(errorMessage(err));
  }

  if (rows.length === 0) {
    // The expensive part (the ccusage scan) already happened, so this counts
    // against the throttle -- an idle machine must not rescan every turn.
    if (!dryRun) writeLastSyncAt(Date.now());
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
    writeLastSyncAt(Date.now());
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

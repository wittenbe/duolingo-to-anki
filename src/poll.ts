import { setTimeout as sleep } from "timers/promises";
import { DUOLINGO_CONFIG, FULL_SYNC_INTERVAL_HOURS, POLL_INTERVAL_MINUTES } from "./config.js";
import { fetchVocabFingerprint } from "./duolingo/client.js";
import { publishPrompt, runSync } from "./run-sync.js";

const pollIntervalMs = POLL_INTERVAL_MINUTES * 60_000;
const fullSyncIntervalMs = FULL_SYNC_INTERVAL_HOURS * 3_600_000;

// In-memory only: a restart triggers one full sync, which is idempotent.
let lastFingerprint: string | undefined;
let lastFullSyncAt = 0;

async function tick(): Promise<void> {
  const fingerprint = await fetchVocabFingerprint(DUOLINGO_CONFIG);
  const fullSyncDue = Date.now() - lastFullSyncAt >= fullSyncIntervalMs;

  if (fingerprint === lastFingerprint && !fullSyncDue) {
    console.log(`[${new Date().toISOString()}] No new vocab (${fingerprint})`);
    return;
  }

  const reason = lastFingerprint === undefined
    ? "startup"
    : fingerprint !== lastFingerprint
      ? `vocab changed ${lastFingerprint} → ${fingerprint}`
      : "periodic full sync";
  console.log(`[${new Date().toISOString()}] Syncing (${reason})`);

  await runSync();
  lastFingerprint = fingerprint;
  lastFullSyncAt = Date.now();
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

console.log(`Polling every ${POLL_INTERVAL_MINUTES} min, full sync every ${FULL_SYNC_INTERVAL_HOURS} h`);
while (true) {
  try {
    await tick();
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Tick failed, will retry next interval:`, err);
  }
  // Also picks up template edits and retries failed uploads between full syncs.
  await publishPrompt();
  await sleep(pollIntervalMs);
}

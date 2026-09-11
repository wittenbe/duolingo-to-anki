import { ANKI_DECKS, ANKI_URL, DUOLINGO_CONFIG, VOCAB_FILE } from "./config.js";
import { fetchLearnedVocab } from "./duolingo/client.js";
import { createAnkiClient } from "./anki/client.js";
import { pushToAnki } from "./anki/sync.js";
import { writeVocabFile } from "./vocab-file.js";

export async function runSync(): Promise<void> {
  const anki = createAnkiClient(ANKI_URL);

  // Pull first and bail if that fails: an unsynced collection (fresh container, not logged in,
  // or a full sync pending) must never be modified, or it could later overwrite AnkiWeb.
  console.log("Syncing with AnkiWeb before making changes...");
  try {
    await anki.request("sync");
  } catch (err) {
    throw new Error(
      `AnkiWeb sync failed, not touching the collection. If this is a fresh setup or a full sync is ` +
        `pending, open Anki over VNC, log in and sync (choose Download). Cause: ${(err as Error).message}`,
    );
  }

  console.log("Fetching Duolingo vocab...");
  const vocab = await fetchLearnedVocab(DUOLINGO_CONFIG, { log: console.log });
  console.log(`Got ${vocab.length} words\n`);

  if (VOCAB_FILE) writeVocabFile(vocab, VOCAB_FILE);

  console.log("\nPushing to Anki...");
  const { hasChanges } = await pushToAnki(anki, vocab, ANKI_DECKS);

  if (hasChanges) {
    console.log("\nSyncing with AnkiWeb...");
    await anki.request("sync");
  } else {
    console.log("\nNo changes, skipping AnkiWeb sync.");
  }

  console.log("Done!");
}

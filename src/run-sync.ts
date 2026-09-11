import {
  ANKI_DECKS,
  ANKI_URL,
  DUOLINGO_CONFIG,
  GOOGLE_DRIVE_FILE_ID,
  GOOGLE_SERVICE_ACCOUNT_KEY,
  PROMPT_DIR,
  VOCAB_FILE,
} from "./config.js";
import { fetchLearnedVocab } from "./duolingo/client.js";
import { createAnkiClient } from "./anki/client.js";
import { pushToAnki } from "./anki/sync.js";
import { createDriveClient } from "./google/drive.js";
import { createPromptPublisher } from "./prompt/publisher.js";

const promptPublisher = createPromptPublisher({
  templateDir: PROMPT_DIR,
  localFile: VOCAB_FILE || undefined,
  drive: GOOGLE_DRIVE_FILE_ID
    ? { client: createDriveClient(GOOGLE_SERVICE_ACCOUNT_KEY), fileId: GOOGLE_DRIVE_FILE_ID }
    : undefined,
});

/** Publishes the vocabulary prompt if it (or its template) changed; failures are logged, not thrown. */
export async function publishPrompt(): Promise<void> {
  try {
    await promptPublisher.publishIfChanged();
  } catch (err) {
    console.error("Publishing the vocabulary prompt failed, will retry next poll:", err);
  }
}

export async function runSync(): Promise<void> {
  console.log("Fetching Duolingo vocab...");
  const vocab = await fetchLearnedVocab(DUOLINGO_CONFIG, { log: console.log });
  console.log(`Got ${vocab.length} words\n`);

  promptPublisher.setVocabulary(vocab.map((v) => v.text));
  await publishPrompt();

  const anki = createAnkiClient(ANKI_URL);

  // Pull first and bail if that fails: an unsynced collection (fresh container, not logged in,
  // or a full sync pending) must never be modified, or it could later overwrite AnkiWeb.
  console.log("\nSyncing with AnkiWeb before making changes...");
  try {
    await anki.request("sync");
  } catch (err) {
    throw new Error(
      `AnkiWeb sync failed, not touching the collection. If this is a fresh setup or a full sync is ` +
        `pending, open Anki over VNC, log in and sync (choose Download). Cause: ${(err as Error).message}`,
    );
  }

  console.log("Pushing to Anki...");
  const { hasChanges } = await pushToAnki(anki, vocab, ANKI_DECKS);

  if (hasChanges) {
    console.log("\nSyncing with AnkiWeb...");
    await anki.request("sync");
  } else {
    console.log("\nNo changes, skipping AnkiWeb sync.");
  }

  console.log("Done!");
}

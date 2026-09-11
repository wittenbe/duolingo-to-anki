import { ANKI_DECKS, ANKI_URL, DUOLINGO_CONFIG, VOCAB_FILE } from "./config.js";
import { fetchLearnedVocab } from "./duolingo/client.js";
import { createAnkiClient } from "./anki/client.js";
import { pushToAnki } from "./anki/sync.js";
import { writeVocabFile } from "./vocab-file.js";

export async function runSync(): Promise<void> {
  console.log("Fetching Duolingo vocab...");
  const vocab = await fetchLearnedVocab(DUOLINGO_CONFIG, { log: console.log });
  console.log(`Got ${vocab.length} words\n`);

  writeVocabFile(vocab, VOCAB_FILE);

  console.log("\nPushing to Anki...");
  const anki = createAnkiClient(ANKI_URL);
  const { hasChanges } = await pushToAnki(anki, vocab, ANKI_DECKS);

  if (hasChanges) {
    console.log("\nSyncing with AnkiWeb...");
    await anki.request("sync");
  } else {
    console.log("\nNo changes, skipping AnkiWeb sync.");
  }

  console.log("Done!");
}

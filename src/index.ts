import "dotenv/config";
import { requireEnv } from "./env.js";
import { fetchLearnedVocab, type DuolingoConfig } from "./duolingo/client.js";
import { createAnkiClient } from "./anki/client.js";
import { pushToAnki, type AnkiDecks } from "./anki/sync.js";
import { writeVocabFile } from "./vocab-file.js";

const DUOLINGO_CONFIG: DuolingoConfig = {
  userId: requireEnv("DUOLINGO_USER_ID"),
  token: requireEnv("DUOLINGO_TOKEN"),
};

const ANKI_URL = process.env.ANKI_URL ?? "http://localhost:8765";
const ANKI_DECKS: AnkiDecks = {
  esEn: "Duolingo Spanish (ES → EN)",
  enEs: "Duolingo Spanish (EN → ES)",
};
const ENABLE_ES_EN = false;
const VOCAB_FILE = "spanish_vocab_prompt.txt";

async function main(): Promise<void> {
  console.log("Fetching Duolingo vocab...");
  const vocab = await fetchLearnedVocab(DUOLINGO_CONFIG, { log: console.log });
  console.log(`Got ${vocab.length} words\n`);

  writeVocabFile(vocab, VOCAB_FILE);

  console.log("\nPushing to Anki...");
  const anki = createAnkiClient(ANKI_URL);
  const { hasChanges } = await pushToAnki(anki, vocab, ANKI_DECKS, { enableEsEn: ENABLE_ES_EN });

  if (hasChanges) {
    console.log("\nSyncing with AnkiWeb...");
    await anki.request("sync");
  } else {
    console.log("\nNo changes, skipping AnkiWeb sync.");
  }

  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

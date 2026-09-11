import "dotenv/config";
import { requireEnv } from "./env.js";
import type { DuolingoConfig } from "./duolingo/client.js";
import type { AnkiDecks } from "./anki/sync.js";

export const DUOLINGO_CONFIG: DuolingoConfig = {
  userId: requireEnv("DUOLINGO_USER_ID"),
  token: requireEnv("DUOLINGO_TOKEN"),
};

export const ANKI_URL = process.env.ANKI_URL ?? "http://localhost:8765";
export const ANKI_DECKS: AnkiDecks = {
  parent: "Español (Duolingo)",
  enEs: "Español (Duolingo)::English → Spanish",
  esEn: "Español (Duolingo)::Spanish → English",
};
export const PROMPT_DIR = "prompt";
// Set to an empty string to skip writing the prompt file.
export const VOCAB_FILE = process.env.VOCAB_FILE ?? "spanish_vocab_prompt.txt";
// Unset disables uploading the prompt to Google Drive.
export const GOOGLE_DRIVE_FILE_ID = process.env.GOOGLE_DRIVE_FILE_ID || undefined;
export const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? "google-service-account.json";

export const POLL_INTERVAL_MINUTES = Number(process.env.POLL_INTERVAL_MINUTES ?? 10);
export const FULL_SYNC_INTERVAL_HOURS = Number(process.env.FULL_SYNC_INTERVAL_HOURS ?? 24);

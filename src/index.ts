import { writeFileSync } from "fs";
import "dotenv/config";

// --- Config ------------------------------------------------------------------

const USER_ID = requireEnv("DUOLINGO_USER_ID");
const TOKEN = requireEnv("DUOLINGO_TOKEN");
const ANKI_DECK_ES_EN = "Duolingo Spanish (ES → EN)";
const ANKI_DECK_EN_ES = "Duolingo Spanish (EN → ES)";
const ANKI_URL = "http://localhost:8765";
const LIMIT = 100;
const VOCAB_FILE = "spanish_vocab_prompt.txt";

const ENABLE_ES_EN = false;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const DUOLINGO_HEADERS: HeadersInit = {
  "Authorization": TOKEN,
  "Content-Type": "application/json; charset=UTF-8",
  "Accept": "application/json; charset=UTF-8",
};

// --- Types -------------------------------------------------------------------

interface Skill {
  id: string;
  finishedLessons: number;
  finishedLevels: number;
}

interface CurrentCourse {
  numberOfWords: number;
  skills: Skill[];
}

interface DuolingoProfile {
  currentCourse: CurrentCourse;
}

interface VocabItem {
  text: string;
  translations: string[] | string | null;
}

interface Pagination {
  totalLexemes: number;
  nextStartIndex: number | null;
}

interface AnkiResponse {
  result: unknown;
  error: string | null;
}

// --- Duolingo ----------------------------------------------------------------

async function buildBody() {
  const url = `https://www.duolingo.com/2023-05-23/users/${USER_ID}?fields=currentCourse&_=${Date.now()}`;
  const res = await fetch(url, { headers: DUOLINGO_HEADERS });
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);

  const { currentCourse } = (await res.json()) as DuolingoProfile;

  const progressedSkills = currentCourse.skills
    .flat()
    .filter((s) => s.finishedLessons > 0 && s.finishedLevels > 0)
    .map((s) => ({
      skillId: { id: s.id },
      finishedLessons: s.finishedLessons,
      finishedLevels: s.finishedLevels,
    }));

  return { progressedSkills };
}

async function fetchDuolingoVocab(): Promise<VocabItem[]> {
  const body = await buildBody();
  console.log(`Built body: ${body.progressedSkills.length} skills`);

  let offset = 0;
  const all: VocabItem[] = [];

  while (true) {
    const url = `https://www.duolingo.com/2017-06-30/users/${USER_ID}/courses/es/en/learned-lexemes?sortBy=LEARNED_DATE&startIndex=${offset}&limit=${LIMIT}`;
    const res = await fetch(url, {
      method: "POST",
      headers: DUOLINGO_HEADERS,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const data: any = await res.json();
    const pagination: Pagination = data.pagination;
    const items: VocabItem[] = (
      Array.isArray(data) ? data : (data.learnedLexemes ?? data.results ?? data.data ?? [])
    )
      .map(({ text, translations }: VocabItem) => ({ text, translations }))
      .filter(({ text, translations }: VocabItem) => translations!.length !== 1 || translations![0] !== text);

    if (items.length === 0) break;
    all.push(...items);
    console.log(`Fetched ${items.length} items (total: ${all.length} / ${pagination?.totalLexemes ?? "?"})`);

    if (pagination?.nextStartIndex == null) break;
    offset = pagination.nextStartIndex;
  }

  return all;
}

// --- AnkiConnect -------------------------------------------------------------

async function ankiRequest<T>(action: string, params: object = {}): Promise<T> {
  const res = await fetch(ANKI_URL, {
    method: "POST",
    body: JSON.stringify({ action, version: 6, params }),
  });
  const { result, error } = (await res.json()) as AnkiResponse;
  if (error) throw new Error(`AnkiConnect error (${action}): ${error}`);
  return result as T;
}

async function ensureDeck(name: string): Promise<void> {
  const decks = await ankiRequest<string[]>("deckNames");
  if (!decks.includes(name)) {
    await ankiRequest("createDeck", { deck: name });
    console.log(`Created deck: "${name}"`);
  }
}

type NotePayload = {
  deckName: string;
  modelName: string;
  fields: { Front: string; Back: string };
  options: { allowDuplicate: boolean };
  tags: string[];
};

async function upsertNotes(notes: NotePayload[], label: string): Promise<void> {
  if (notes.length === 0) return;

  const deckName = notes[0].deckName;

  // 1. Fetch all existing note IDs in the deck
  const allNoteIds = await ankiRequest<number[]>("findNotes", {
    query: `"deck:${deckName}"`,
  });

  // 2. Build a map of Front -> { noteId, back }
  const existingMap = new Map<string, { noteId: number; back: string }>();
  if (allNoteIds.length > 0) {
    const infos = await ankiRequest<
      { noteId: number; fields: { Front: { value: string }; Back: { value: string } } }[]
    >("notesInfo", { notes: allNoteIds });

    for (const info of infos) {
      existingMap.set(info.fields.Front.value, {
        noteId: info.noteId,
        back: info.fields.Back.value,
      });
    }
  }

  // 3. Sort into add / update / unchanged
  const toAdd: NotePayload[] = [];
  const toUpdate: { id: number; fields: { Front: string; Back: string } }[] = [];
  let unchanged = 0;

  for (const note of notes) {
    const existing = existingMap.get(note.fields.Front);
    if (!existing) {
      toAdd.push(note);
    } else if (existing.back !== note.fields.Back) {
      toUpdate.push({ id: existing.noteId, fields: note.fields });
    } else {
      unchanged++;
    }
  }

  // 4. Bulk add
  if (toAdd.length > 0) {
    await ankiRequest("addNotes", { notes: toAdd.filter((add) => add.fields.Front !== "") });
  }

  // 5. Bulk update (no batch API, but much fewer calls now)
  for (const note of toUpdate) {
    await ankiRequest("updateNoteFields", { note });
  }

  console.log(
    `${label}: ${toAdd.length} added, ${toUpdate.length} updated, ${unchanged} unchanged`,
  );

  for (const note of toAdd) {
    console.log(`  + ${note.fields.Front} → ${note.fields.Back}`);
  }
  for (const note of toUpdate) {
    const oldBack = existingMap.get(note.fields.Front)!.back;
    console.log(`  ~ ${note.fields.Front}: "${oldBack}" → "${note.fields.Back}"`);
  }
}

async function pushToAnki(items: VocabItem[]): Promise<void> {
  const esEnNotes: NotePayload[] = items.map(({ text, translations }) => ({
    deckName: ANKI_DECK_ES_EN,
    modelName: "Basic",
    fields: {
      Front: text,
      Back: Array.isArray(translations) ? translations.join(", ") : (translations ?? ""),
    },
    options: { allowDuplicate: false },
    tags: ["duolingo", "spanish", "es-en"],
  }));

  const enEsMap = new Map<string, Set<string>>();
  for (const { text, translations } of items) {
    const newText = (translations as string[]).join(", ");
    const newTranslation = text;

    if (!enEsMap.has(newText)) enEsMap.set(newText, new Set());
    enEsMap.get(newText)!.add(newTranslation);
  }

  const enEsNotes: NotePayload[] = Array.from(enEsMap.entries()).map(([front, backs]) => ({
    deckName: ANKI_DECK_EN_ES,
    modelName: "Basic",
    fields: {
      Front: front,
      Back: Array.from(backs).join(", "),
    },
    options: { allowDuplicate: false },
    tags: ["duolingo", "spanish", "en-es"],
  }));

  if (ENABLE_ES_EN) {
    await ensureDeck(ANKI_DECK_ES_EN);
    await upsertNotes(esEnNotes, "ES→EN");
  }

  await ensureDeck(ANKI_DECK_EN_ES);
  await upsertNotes(enEsNotes, "EN→ES");
}

// --- Vocab file --------------------------------------------------------------

const PROMPT = `\
You are a Spanish language tutor. Using ONLY the vocabulary words listed below, \
generate a challenging English sentence for me to translate into Spanish.
After I present my answer, correct any mistakes and then give me another one.
Respond and give feedback in English.

It is important that you only use words from this list, though minor changes are of course ok
(e.g. if compartir is present, any other conjugation is fair game)

Assume that I reply via voice, so any missing punctuation or accents are a consequence of that,
and you don't have to correct that.

---
VOCABULARY:`;

function writeVocabFile(items: VocabItem[]): void {
  const words = items.map((v) => v.text).join("\n");
  const content = `${PROMPT}\n${words}\n`;
  writeFileSync(VOCAB_FILE, content, "utf-8");
  console.log(`Wrote ${items.length} words to ${VOCAB_FILE}`);
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("Fetching Duolingo vocab...");
  const vocab = await fetchDuolingoVocab();
  console.log(`Got ${vocab.length} words\n`);

  writeVocabFile(vocab);

  console.log("\nPushing to Anki...");
  await pushToAnki(vocab);

  console.log("\nSyncing with AnkiWeb...");
  await ankiRequest("sync");
  console.log("Done!");
}

main().catch(console.error);

import type { AnkiClient } from "./client.js";
import type { VocabItem } from "../duolingo/types.js";

type NotePayload = {
  deckName: string;
  modelName: string;
  fields: { Front: string; Back: string };
  options: { allowDuplicate: boolean };
  tags: string[];
};

interface UpsertResult {
  added: number;
  updated: number;
  unchanged: number;
}

async function upsertNotes(anki: AnkiClient, notes: NotePayload[], label: string): Promise<UpsertResult> {
  if (notes.length === 0) return { added: 0, updated: 0, unchanged: 0 };

  const deckName = notes[0].deckName;

  // 1. Fetch all existing note IDs in the deck
  const allNoteIds = await anki.request<number[]>("findNotes", {
    query: `"deck:${deckName}"`,
  });

  // 2. Build a map of Front -> { noteId, back }
  const existingMap = new Map<string, { noteId: number; back: string }>();
  if (allNoteIds.length > 0) {
    const infos = await anki.request<
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
    await anki.request("addNotes", { notes: toAdd.filter((add) => add.fields.Front !== "") });
  }

  // 5. Bulk update (no batch API, but much fewer calls now)
  for (const note of toUpdate) {
    await anki.request("updateNoteFields", { note });
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

  return { added: toAdd.length, updated: toUpdate.length, unchanged };
}

export interface AnkiDecks {
  esEn: string;
  enEs: string;
}

export interface PushOptions {
  enableEsEn: boolean;
}

export interface PushResult {
  hasChanges: boolean;
}

export async function pushToAnki(
  anki: AnkiClient,
  items: VocabItem[],
  decks: AnkiDecks,
  options: PushOptions,
): Promise<PushResult> {
  const esEnNotes: NotePayload[] = items.map(({ text, translations }) => ({
    deckName: decks.esEn,
    modelName: "Basic",
    fields: {
      Front: text,
      Back: translations.join(", "),
    },
    options: { allowDuplicate: false },
    tags: ["duolingo", "spanish", "es-en"],
  }));

  const enEsMap = new Map<string, Set<string>>();
  for (const { text, translations } of items) {
    const front = translations.join(", ");
    if (!enEsMap.has(front)) enEsMap.set(front, new Set());
    enEsMap.get(front)!.add(text);
  }

  const enEsNotes: NotePayload[] = Array.from(enEsMap.entries()).map(([front, backs]) => ({
    deckName: decks.enEs,
    modelName: "Basic",
    fields: {
      Front: front,
      Back: Array.from(backs).join(", "),
    },
    options: { allowDuplicate: false },
    tags: ["duolingo", "spanish", "en-es"],
  }));

  let hasChanges = false;

  if (options.enableEsEn) {
    await anki.ensureDeck(decks.esEn);
    const result = await upsertNotes(anki, esEnNotes, "ES→EN");
    hasChanges ||= result.added + result.updated > 0;
  }

  await anki.ensureDeck(decks.enEs);
  const enEsResult = await upsertNotes(anki, enEsNotes, "EN→ES");
  hasChanges ||= enEsResult.added + enEsResult.updated > 0;

  return { hasChanges };
}

import type { AnkiClient } from "./client.js";
import type { VocabItem } from "../duolingo/types.js";
import { ensureNoteType, NOTE_TYPE_NAME, TEMPLATE_EN_ES, TEMPLATE_ES_EN, type NoteFields } from "./note-type.js";

const TAGS = ["duolingo", "spanish"];

// Refuse to delete more than this share of the deck in one run; a truncated
// Duolingo response would otherwise wipe review history.
const MAX_PRUNE_FRACTION = 0.1;

export interface DesiredNote {
  spanish: string;
  english: string;
  alsoAccepted: string;
  audioUrl?: string;
}

interface ExistingNote {
  noteId: number;
  fields: NoteFields;
}

export interface AnkiDecks {
  parent: string;
  enEs: string;
  esEn: string;
}

export interface PushResult {
  hasChanges: boolean;
}

function isCardWorthy({ text, translations }: VocabItem): boolean {
  if (translations.length === 0) return false;
  return !(translations.length === 1 && translations[0] === text);
}

export function buildDesiredNotes(items: VocabItem[]): DesiredNote[] {
  const eligible = [...new Map(items.filter(isCardWorthy).map((i) => [i.text, i])).values()];

  const spanishByEnglish = new Map<string, string[]>();
  for (const { text, translations } of eligible) {
    const english = translations.join(", ");
    spanishByEnglish.set(english, [...(spanishByEnglish.get(english) ?? []), text]);
  }

  return eligible.map(({ text, translations, audioUrl }) => {
    const english = translations.join(", ");
    return {
      spanish: text,
      english,
      alsoAccepted: spanishByEnglish.get(english)!.filter((w) => w !== text).join(", "),
      audioUrl,
    };
  });
}

export function audioAttachment(note: DesiredNote) {
  if (!note.audioUrl) return undefined;
  const id = note.audioUrl.split("/").pop();
  return [{ url: note.audioUrl, filename: `duolingo_es_${id}.mp3`, fields: ["Audio"] }];
}

async function fetchExistingNotes(anki: AnkiClient, deck: string): Promise<Map<string, ExistingNote>> {
  const ids = await anki.request<number[]>("findNotes", {
    query: `"deck:${deck}" "note:${NOTE_TYPE_NAME}"`,
  });
  if (ids.length === 0) return new Map();

  const infos = await anki.request<{ noteId: number; fields: Record<keyof NoteFields, { value: string }> }[]>(
    "notesInfo",
    { notes: ids },
  );
  return new Map(
    infos.map((info) => [
      info.fields.Spanish.value,
      {
        noteId: info.noteId,
        fields: {
          Spanish: info.fields.Spanish.value,
          English: info.fields.English.value,
          AlsoAccepted: info.fields.AlsoAccepted.value,
          Audio: info.fields.Audio.value,
        },
      },
    ]),
  );
}

// Anki adds all of a new note's cards to one deck; move each direction into its own subdeck.
async function placeCardsByDirection(anki: AnkiClient, decks: AnkiDecks): Promise<number> {
  let moved = 0;
  for (const [template, target] of [[TEMPLATE_EN_ES, decks.enEs], [TEMPLATE_ES_EN, decks.esEn]]) {
    const cards = await anki.request<number[]>("findCards", {
      query: `"deck:${decks.parent}" "note:${NOTE_TYPE_NAME}" "card:${template}" -"deck:${target}"`,
    });
    if (cards.length === 0) continue;
    await anki.request("changeDeck", { cards, deck: target });
    moved += cards.length;
  }
  return moved;
}

export async function pushToAnki(anki: AnkiClient, items: VocabItem[], decks: AnkiDecks): Promise<PushResult> {
  await ensureNoteType(anki);
  await anki.ensureDeck(decks.enEs);
  await anki.ensureDeck(decks.esEn);

  const desired = buildDesiredNotes(items);
  const existing = await fetchExistingNotes(anki, decks.parent);

  const toAdd = desired.filter((d) => !existing.has(d.spanish));
  if (toAdd.length > 0) {
    await anki.request("addNotes", {
      notes: toAdd.map((d) => ({
        deckName: decks.enEs,
        modelName: NOTE_TYPE_NAME,
        fields: { Spanish: d.spanish, English: d.english, AlsoAccepted: d.alsoAccepted },
        options: { allowDuplicate: false, duplicateScope: "deck" },
        tags: TAGS,
        audio: audioAttachment(d),
      })),
    });
  }
  for (const d of toAdd) {
    console.log(`  + ${d.english} → ${d.spanish}${d.alsoAccepted ? ` (also: ${d.alsoAccepted})` : ""}`);
  }

  // Words with temporarily empty translations aren't in `desired`, so their cards are left untouched.
  let updated = 0;
  let audioAdded = 0;
  for (const d of desired) {
    const e = existing.get(d.spanish);
    if (!e) continue;

    const fields: Partial<NoteFields> = {};
    if (e.fields.English !== d.english) fields.English = d.english;
    if (e.fields.AlsoAccepted !== d.alsoAccepted) fields.AlsoAccepted = d.alsoAccepted;
    const audio = e.fields.Audio === "" ? audioAttachment(d) : undefined;
    if (Object.keys(fields).length === 0 && !audio) continue;

    await anki.request("updateNoteFields", { note: { id: e.noteId, fields, audio } });
    if (Object.keys(fields).length > 0) {
      updated++;
      console.log(
        `  ~ ${d.spanish}: "${e.fields.English}" → "${d.english}"` +
          (fields.AlsoAccepted !== undefined ? ` (also: "${e.fields.AlsoAccepted}" → "${d.alsoAccepted}")` : ""),
      );
    }
    if (audio) audioAdded++;
  }

  const onDuolingo = new Set(items.map((i) => i.text));
  const stale = [...existing.values()].filter((e) => !onDuolingo.has(e.fields.Spanish));
  let deleted = 0;
  if (stale.length > existing.size * MAX_PRUNE_FRACTION) {
    console.warn(
      `  ! ${stale.length} of ${existing.size} notes are no longer on Duolingo; ` +
        `refusing to delete more than ${MAX_PRUNE_FRACTION * 100}% at once`,
    );
  } else if (stale.length > 0) {
    await anki.request("deleteNotes", { notes: stale.map((e) => e.noteId) });
    deleted = stale.length;
    for (const e of stale) console.log(`  - ${e.fields.English} → ${e.fields.Spanish}`);
  }

  const moved = await placeCardsByDirection(anki, decks);

  const unchanged = desired.length - toAdd.length - updated;
  console.log(
    `${decks.parent}: ${toAdd.length} added, ${updated} updated, ${deleted} deleted, ${unchanged} unchanged` +
      (audioAdded > 0 ? `, audio attached to ${audioAdded}` : "") +
      (moved > 0 ? `, ${moved} cards moved to their direction's subdeck` : ""),
  );

  return { hasChanges: toAdd.length + updated + deleted + audioAdded + moved > 0 };
}

import type { AnkiClient } from "./client.js";
import { NOTE_TYPE_NAME, type NoteFields } from "./note-type.js";
import { sample } from "../random.js";

/**
 * Picks the words for a drill set out of Anki, which is the only thing here that knows how you are
 * actually doing. Each pool is an Anki search, so the scheduler does the judging, not us.
 *
 * The searches use Anki's own syntax and run inside the collection; see
 * https://docs.ankiweb.net/searching.html for the operators.
 */
export const DRILL_POOLS = [
  /** Words you keep getting wrong. */
  { name: "lapsing", search: "prop:lapses>2", share: 0.375 },
  /** Due today anyway, so drilling them is free review. */
  { name: "due", search: "is:due", share: 0.375 },
  /** Learned in the last month: known, but not yet settled. */
  { name: "recent", search: "introduced:30", share: 0.25 },
];

export interface DrillWords {
  words: string[];
  /** How many words each pool contributed, for the log line. */
  counts: Record<string, number>;
}

async function spanishOf(anki: AnkiClient, noteIds: number[]): Promise<string[]> {
  if (noteIds.length === 0) return [];
  const infos = await anki.request<{ fields: Record<keyof NoteFields, { value: string }> }[]>("notesInfo", {
    notes: noteIds,
  });
  return infos.map((info) => info.fields.Spanish?.value).filter((value): value is string => !!value);
}

/**
 * Returns up to `total` words, weighted across the pools above. Pools that come up short are made
 * up for from the rest of the deck, so a deck with nothing due still yields a full set.
 */
export async function selectDrillWords(
  anki: AnkiClient,
  deck: string,
  total: number,
  random: () => number,
): Promise<DrillWords> {
  const scope = `"deck:${deck}" "note:${NOTE_TYPE_NAME}" -is:suspended`;
  const chosen = new Set<number>();
  const counts: Record<string, number> = {};

  for (const pool of DRILL_POOLS) {
    const ids = await anki.request<number[]>("findNotes", { query: `${scope} ${pool.search}` });
    const picked = sample(
      ids.filter((id) => !chosen.has(id)),
      Math.round(total * pool.share),
      random,
    );
    picked.forEach((id) => chosen.add(id));
    counts[pool.name] = picked.length;
  }

  if (chosen.size < total) {
    const ids = await anki.request<number[]>("findNotes", { query: scope });
    const filler = sample(
      ids.filter((id) => !chosen.has(id)),
      total - chosen.size,
      random,
    );
    filler.forEach((id) => chosen.add(id));
    counts.other = filler.length;
  }

  return { words: await spanishOf(anki, [...chosen]), counts };
}

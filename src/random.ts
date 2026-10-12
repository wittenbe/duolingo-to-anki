/**
 * Deterministic randomness, seeded by a string. The daily drill set is seeded with the date, so
 * every run on the same day produces the same set: the Drive file is then rewritten once a day
 * rather than on every poll, and reopening a chat later in the day gets you the same words.
 */
export function seededRandom(seed: string): () => number {
  // xmur3 to spread the string into a 32-bit state, then mulberry32 for the stream itself.
  let h = 1779033703 ^ seed.length;
  for (const char of seed) {
    h = Math.imul(h ^ char.charCodeAt(0), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function sample<T>(items: readonly T[], count: number, random: () => number): T[] {
  return shuffled(items, random).slice(0, count);
}

/** The seed for today, e.g. "2026-10-12". UTC, so a run just after midnight local time is stable. */
export function todaySeed(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

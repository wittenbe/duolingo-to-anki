import {
  ANKI_DECKS,
  ANKI_URL,
  DRILL_SPOTLIGHT_COUNT,
  DRILL_WORD_COUNT,
  DUOLINGO_CONFIG,
  GOOGLE_DRIVE_DAILY_FILE_ID,
  GOOGLE_DRIVE_FILE_ID,
  GOOGLE_SERVICE_ACCOUNT_KEY,
  PROMPT_DIR,
} from "./config.js";
import { fetchLearnedVocab, fetchProfile } from "./duolingo/client.js";
import {
  classifyUnits,
  conceptCoverageWarning,
  createGuidebookReader,
  nearHorizon,
  readGuidebooks,
} from "./duolingo/guidebook.js";
import type { Profile } from "./duolingo/schemas.js";
import type { VocabItem } from "./duolingo/types.js";
import { createAnkiClient } from "./anki/client.js";
import { selectDrillWords } from "./anki/selection.js";
import { pushToAnki } from "./anki/sync.js";
import { createDriveClient } from "./google/drive.js";
import { createPromptPublisher, type PublishTarget } from "./prompt/publisher.js";
import { dailyTarget, referenceTarget, type Grammar } from "./prompt/targets.js";
import { sample, seededRandom, todaySeed } from "./random.js";

const promptPublisher =
  GOOGLE_DRIVE_FILE_ID || GOOGLE_DRIVE_DAILY_FILE_ID
    ? createPromptPublisher({ templateDir: PROMPT_DIR, drive: createDriveClient(GOOGLE_SERVICE_ACCOUNT_KEY) })
    : undefined;

// Today's drill set, kept so that every run on the same day publishes the same words. Anki's
// pools shift as you review (is:due above all), so without this the file would change on every
// poll. A restart picks a new set for the rest of the day, which is harmless.
let drillSet: { seed: string; words: string[] } | undefined;

// Module level, so its cache outlives a single run. Guidebook URLs contain a hash of their
// content, so after the first pass only newly finished units are fetched.
const guidebooks = createGuidebookReader(console.log);

/** Publishes the prompts if they (or their templates) changed; failures are logged, not thrown. */
export async function publishPrompt(): Promise<void> {
  try {
    await promptPublisher?.publishIfChanged();
  } catch (err) {
    console.error("Publishing the prompts failed, will retry next poll:", err);
  }
}

/**
 * Reads the grammar tips of the units you have finished, the one you are in and the ones just
 * ahead. Grammar is a bonus on top of the vocabulary, so every failure here degrades to "no
 * grammar in the prompts" rather than failing the run.
 */
async function loadGrammar(profile: Profile): Promise<Grammar | undefined> {
  const sections = profile.currentCourse.pathSectioned;
  if (sections.length === 0) {
    console.warn(
      "  ! no path sections in the profile, so no grammar. If Duolingo changed the response, " +
        "check ProfileSchema in src/duolingo/schemas.ts",
    );
    return undefined;
  }

  const units = classifyUnits(sections);
  const finished = await readGuidebooks(guidebooks, units.finished);
  const current = units.current ? await guidebooks.read(units.current) : undefined;
  const upcoming = await readGuidebooks(guidebooks, nearHorizon(units));

  const count = (list: { concepts: unknown[] }[]) => list.reduce((sum, u) => sum + u.concepts.length, 0);
  console.log(
    `Grammar: ${count(finished)} concepts from ${finished.length} finished units, ` +
      `${count(upcoming)} still ahead` +
      (current ? `, ${count([current])} in the unit in progress` : "") +
      ` (${guidebooks.stats.fetched} guidebooks fetched, ${guidebooks.stats.failed} failed)`,
  );

  const warning = conceptCoverageWarning(finished);
  if (warning) console.warn(`  ! ${warning}`);

  return { finished, current, upcoming };
}

export async function runSync(): Promise<void> {
  console.log("Fetching Duolingo vocab...");
  const profile = await fetchProfile(DUOLINGO_CONFIG);
  const vocab = await fetchLearnedVocab(DUOLINGO_CONFIG, profile, { log: console.log });
  console.log(`Got ${vocab.length} words\n`);

  const grammar = await loadGrammar(profile);
  const seed = todaySeed();
  const wordRandom = () => seededRandom(`words:${seed}`);

  const reference: PublishTarget[] = GOOGLE_DRIVE_FILE_ID
    ? [referenceTarget(GOOGLE_DRIVE_FILE_ID, vocab, grammar)]
    : [];
  const withDaily = (words: string[]): PublishTarget[] => [
    ...reference,
    ...(GOOGLE_DRIVE_DAILY_FILE_ID
      ? [
          dailyTarget({
            fileId: GOOGLE_DRIVE_DAILY_FILE_ID,
            seed,
            words,
            grammar,
            spotlightCount: DRILL_SPOTLIGHT_COUNT,
          }),
        ]
      : []),
  ];

  // The reference prompt needs nothing from Anki, so publish it before touching the collection.
  promptPublisher?.setTargets(reference);
  await publishPrompt();

  const anki = createAnkiClient(ANKI_URL);

  // Pull first and bail if that fails: an unsynced collection (fresh container, not logged in,
  // or a full sync pending) must never be modified, or it could later overwrite AnkiWeb.
  console.log("\nSyncing with AnkiWeb before making changes...");
  try {
    await anki.request("sync");
  } catch (err) {
    // Still publish a drill set, sampled from Duolingo rather than picked by Anki's scheduler.
    promptPublisher?.setTargets(withDaily(sample(vocab.map((v) => v.text), DRILL_WORD_COUNT, wordRandom())));
    await publishPrompt();
    throw new Error(
      `AnkiWeb sync failed, not touching the collection. On a fresh setup, open Anki over VNC, log in ` +
        `and sync (choose Download). If a full sync is pending, do it over VNC as well; the README says ` +
        `which direction. Cause: ${(err as Error).message}`,
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

  // After the push, so a word added in this run can be drilled the same day.
  promptPublisher?.setTargets(withDaily(await drillWords(anki, vocab, seed, wordRandom())));
  await publishPrompt();

  console.log("Done!");
}

/** The drill set, from Anki's scheduler when it answers and from a plain sample when it doesn't. */
async function drillWords(
  anki: ReturnType<typeof createAnkiClient>,
  vocab: VocabItem[],
  seed: string,
  random: () => number,
): Promise<string[]> {
  if (!GOOGLE_DRIVE_DAILY_FILE_ID) return [];
  if (drillSet?.seed === seed) return drillSet.words;

  try {
    const { words, counts } = await selectDrillWords(anki, ANKI_DECKS.parent, DRILL_WORD_COUNT, random);
    const summary = Object.entries(counts)
      .map(([pool, n]) => `${n} ${pool}`)
      .join(", ");
    console.log(`Drill set for ${seed}: ${words.length} words (${summary})`);
    drillSet = { seed, words };
    return words;
  } catch (err) {
    console.error("Picking the drill words from Anki failed, sampling from Duolingo instead:", err);
    return sample(vocab.map((v) => v.text), DRILL_WORD_COUNT, random);
  }
}

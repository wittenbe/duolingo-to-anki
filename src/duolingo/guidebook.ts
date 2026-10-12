import { z } from "zod";
import type { PathSection } from "./schemas.js";

/**
 * Each unit on the Duolingo path has a "guidebook": key phrases plus the unit's grammar tips.
 * Its URL comes from the profile response (`currentCourse.pathSectioned[].units[].guidebook.url`)
 * and needs no auth. The JSON is a flat list of rendered elements, so the only thing marking a
 * grammar concept apart from an example sentence is how it is styled.
 *
 * That styling is an undocumented implementation detail and can change at any time. Every
 * assumption about it lives in GUIDEBOOK_LAYOUT below, so a restyle should mean editing this one
 * object. `conceptCoverageWarning` watches for exactly that and points back here.
 *
 * Verified 2026-10-12 against all 303 units of the es/en course (92 finished, 0 fetch failures):
 * - 139 concepts in the finished units, 126 of them distinct
 * - 82 of 92 finished units have tips; the other 10 teach only vocabulary, which is normal
 * - the 172 units in the B1 and B2 sections carry no tips at all, only key phrases
 */
export const GUIDEBOOK_LAYOUT = {
  /** Element types we read. Everything else (dialogue, example, verticalSpace) is skipped. */
  types: { text: "text", table: "table" },

  /** A grammar concept's heading, e.g. "The imperfect tense". Starts a new concept. */
  title: { fontSize: 25, fontWeight: "bold" },

  /** A paragraph belonging to the concept above it. */
  body: { fontSize: 19 },

  /**
   * Section markers ("KEY PHRASES", "TIP") in Duolingo blue. Not concepts, and skipped by virtue
   * of matching neither style above. Recorded here as documentation of what else turns up.
   */
  marker: { fontSize: 17, fontWeight: "bold", textColor: "1CB0F6" },

  /**
   * Titles to drop, lowercased. The section markers are normally styled as markers, but at least
   * one unit styles its "Key Phrases" heading like a concept, which would otherwise read as
   * grammar you must not use.
   */
  ignoredTitles: ["key phrases", "tip"],

  /**
   * Staleness check: this share of the finished units we fetch should yield at least one concept
   * (measured: 0.89). Below it, the styles above have most likely changed.
   */
  minShareOfUnitsWithConcepts: 0.5,

  /** Below this many finished units, that share is too noisy to judge. */
  minUnitsToJudge: 10,
};

/** Level states that mean "done". Seen 2026-10-12: legendary, passed, active, locked, unit_test. */
const FINISHED_STATES = ["legendary", "passed", "completed"];

const StylingSchema = z.object({
  attributes: z.object({
    fontSize: z.number().nullish(),
    fontWeight: z.string().nullish(),
    textColor: z.string().nullish(),
  }),
});

const StyledStringSchema = z.object({ text: z.string(), styling: z.array(StylingSchema).nullish() });
const TextElementSchema = z.object({ styledString: StyledStringSchema });
const TableElementSchema = z.object({ cells: z.array(z.array(z.object({ styledString: StyledStringSchema }))) });
const GuidebookSchema = z.object({ elements: z.array(z.object({ type: z.string(), element: z.unknown() })) });

export interface GrammarConcept {
  title: string;
  /** The explanation, with any conjugation table flattened onto the end of it. */
  explanation: string;
}

export interface UnitRef {
  unitIndex: number;
  /** Index of the path section the unit belongs to. */
  section: number;
  /** e.g. "A2", or "?" when Duolingo reports no CEFR level for the section. */
  cefr: string;
  objective?: string;
  guidebookUrl: string;
}

export interface UnitGrammar extends UnitRef {
  concepts: GrammarConcept[];
}

type Style = { fontSize?: number | null; fontWeight?: string | null; textColor?: string | null };

/** True when every property the layout specifies matches; properties it leaves out are ignored. */
function hasStyle(styled: z.infer<typeof StyledStringSchema>, wanted: Style): boolean {
  const attributes = styled.styling?.[0]?.attributes;
  if (!attributes) return false;
  return Object.entries(wanted).every(([key, value]) => attributes[key as keyof Style] === value);
}

function flattenTable(table: z.infer<typeof TableElementSchema>): string {
  return table.cells.map((row) => row.map((cell) => cell.styledString.text.trim()).join(" = ")).join("; ");
}

/**
 * Pulls the grammar concepts out of one guidebook. Unknown element types and unexpected shapes are
 * skipped rather than thrown on: one restyled element shouldn't cost us the whole unit.
 */
export function extractConcepts(guidebook: unknown): GrammarConcept[] {
  const parsed = GuidebookSchema.safeParse(guidebook);
  if (!parsed.success) return [];

  const concepts: { title: string; parts: string[] }[] = [];
  for (const { type, element } of parsed.data.elements) {
    if (type === GUIDEBOOK_LAYOUT.types.text) {
      const text = TextElementSchema.safeParse(element);
      if (!text.success) continue;
      const value = text.data.styledString.text.trim();
      if (value === "") continue;

      if (hasStyle(text.data.styledString, GUIDEBOOK_LAYOUT.title)) {
        if (GUIDEBOOK_LAYOUT.ignoredTitles.includes(value.toLowerCase())) continue;
        concepts.push({ title: value, parts: [] });
      }
      else if (hasStyle(text.data.styledString, GUIDEBOOK_LAYOUT.body)) concepts.at(-1)?.parts.push(value);
    } else if (type === GUIDEBOOK_LAYOUT.types.table) {
      // A table follows the paragraph it belongs to, which often ends in a colon.
      const table = TableElementSchema.safeParse(element);
      if (table.success) concepts.at(-1)?.parts.push(flattenTable(table.data));
    }
  }

  return concepts.map(({ title, parts }) => ({ title, explanation: parts.join(" ") }));
}

export interface ClassifiedUnits {
  finished: UnitRef[];
  /** The unit in progress, if any: its tips have been seen but not drilled to the end. */
  current?: UnitRef;
  upcoming: UnitRef[];
}

const isFinished = (levels: { state: string }[]) =>
  levels.length > 0 && levels.every((l) => FINISHED_STATES.includes(l.state));

/**
 * Splits the path into what you have finished, what you are in the middle of and what is ahead.
 *
 * Progress is read off the levels: `isUnlocked` is false on every unit, finished ones included
 * (verified over all 303 units, 2026-10-12), so it cannot be used for this.
 */
export function classifyUnits(sections: PathSection[]): ClassifiedUnits {
  const result: ClassifiedUnits = { finished: [], upcoming: [] };

  for (const section of sections) {
    for (const unit of section.units) {
      if (!unit.guidebook?.url) continue;
      const ref: UnitRef = {
        unitIndex: unit.unitIndex,
        section: section.index,
        cefr: section.cefr ? section.cefr.level : "?",
        objective: unit.teachingObjective ?? undefined,
        guidebookUrl: unit.guidebook.url,
      };

      if (isFinished(unit.levels)) result.finished.push(ref);
      else if (!result.current && unit.levels.some((l) => FINISHED_STATES.includes(l.state))) result.current = ref;
      else result.upcoming.push(ref);
    }
  }

  return result;
}

/**
 * The units just ahead of you, whose grammar a tutor must not demand yet. Everything further out
 * is not worth fetching: verified 2026-10-12, all 52 not-yet-covered concepts sat in the section
 * in progress, and the 172 units of the B1 and B2 sections hold no tips at all.
 */
export function nearHorizon(units: ClassifiedUnits, sectionsAhead = 1): UnitRef[] {
  const sections = [...units.finished, ...(units.current ? [units.current] : [])].map((u) => u.section);
  const limit = Math.max(units.current?.section ?? 0, ...sections) + sectionsAhead;
  return units.upcoming.filter((u) => u.section <= limit);
}

export interface GuidebookReader {
  read(unit: UnitRef): Promise<UnitGrammar>;
  stats: { fetched: number; failed: number };
}

const CONCURRENCY = 8;

/**
 * Reads guidebooks, caching by URL. The URL contains a hash of the content, so a cached entry can
 * never go stale: an edited guidebook arrives under a new URL.
 */
export function createGuidebookReader(log: (message: string) => void = () => {}): GuidebookReader {
  const cache = new Map<string, GrammarConcept[]>();
  const stats = { fetched: 0, failed: 0 };

  return {
    stats,
    async read(unit) {
      const cached = cache.get(unit.guidebookUrl);
      if (cached) return { ...unit, concepts: cached };

      let concepts: GrammarConcept[] = [];
      try {
        const res = await fetch(unit.guidebookUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        concepts = extractConcepts(await res.json());
        stats.fetched++;
        cache.set(unit.guidebookUrl, concepts);
      } catch (err) {
        stats.failed++;
        log(`  ! guidebook for unit ${unit.unitIndex} failed, skipping it: ${(err as Error).message}`);
      }
      return { ...unit, concepts };
    },
  };
}

/** Reads many guidebooks with a little concurrency, returning them in input order. */
export async function readGuidebooks(reader: GuidebookReader, units: UnitRef[]): Promise<UnitGrammar[]> {
  const results: UnitGrammar[] = new Array(units.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, units.length) }, async () => {
      while (next < units.length) {
        const index = next++;
        results[index] = await reader.read(units[index]);
      }
    }),
  );
  return results;
}

/**
 * Returns a warning when far fewer finished units yielded concepts than expected, which almost
 * certainly means Duolingo restyled its guidebooks and GUIDEBOOK_LAYOUT needs updating.
 */
export function conceptCoverageWarning(units: UnitGrammar[]): string | undefined {
  const { minUnitsToJudge, minShareOfUnitsWithConcepts } = GUIDEBOOK_LAYOUT;
  if (units.length < minUnitsToJudge) return undefined;

  const withConcepts = units.filter((u) => u.concepts.length > 0).length;
  if (withConcepts / units.length >= minShareOfUnitsWithConcepts) return undefined;

  return (
    `Only ${withConcepts} of ${units.length} finished units yielded grammar concepts ` +
    `(expected at least ${Math.round(minShareOfUnitsWithConcepts * 100)}%). Duolingo has probably ` +
    `restyled its guidebooks: check GUIDEBOOK_LAYOUT in src/duolingo/guidebook.ts.`
  );
}

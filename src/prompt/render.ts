import type { UnitGrammar, GrammarConcept } from "../duolingo/guidebook.js";
import type { VocabItem } from "../duolingo/types.js";
import { sample } from "../random.js";

/** A concept plus the CEFR level of the unit that first taught it. */
export interface LeveledConcept extends GrammarConcept {
  cefr: string;
}

/** Titles differ in case and trailing punctuation between units ("Double Negatives" vs "Double negatives"). */
export const titleKey = (title: string) => title.toLowerCase().replace(/[.:\s]+$/, "").trim();

/**
 * Flattens units into concepts, dropping repeats. Units arrive in path order, so the level kept
 * for a concept taught twice is the earlier one.
 */
export function dedupeConcepts(units: UnitGrammar[], exclude: Set<string> = new Set()): LeveledConcept[] {
  const seen = new Set(exclude);
  const result: LeveledConcept[] = [];
  for (const unit of units) {
    for (const concept of unit.concepts) {
      if (seen.has(titleKey(concept.title))) continue;
      seen.add(titleKey(concept.title));
      result.push({ ...concept, cefr: unit.cefr });
    }
  }
  return result;
}

function groupByLevel(concepts: LeveledConcept[], line: (concept: LeveledConcept) => string): string {
  const groups = new Map<string, string[]>();
  for (const concept of concepts) {
    groups.set(concept.cefr, [...(groups.get(concept.cefr) ?? []), line(concept)]);
  }
  return [...groups].map(([cefr, lines]) => `${cefr}\n${lines.join("\n")}`).join("\n\n");
}

export function renderVocabulary(vocab: VocabItem[]): string {
  return vocab.map((v) => v.text).join("\n");
}

/** Titles only, grouped by level: the list of structures a tutor may draw on. */
export function renderConceptTitles(concepts: LeveledConcept[]): string {
  return groupByLevel(concepts, (c) => `- ${c.title}`);
}

/** Titles with their explanations, for the reference file. */
export function renderConceptDetails(concepts: LeveledConcept[]): string {
  return groupByLevel(concepts, (c) => `- ${c.title}: ${c.explanation}`);
}

/** A flat list of titles, for the structures that are off limits. */
export function renderTitleList(concepts: LeveledConcept[]): string {
  return concepts.map((c) => `- ${c.title}`).join("\n");
}

export function renderSpotlight(concepts: LeveledConcept[], count: number, random: () => number): string {
  return sample(concepts, count, random)
    .map((c) => `- ${c.title} (${c.cefr}): ${c.explanation}`)
    .join("\n");
}

export function renderWords(words: string[]): string {
  return words.map((word) => `- ${word}`).join("\n");
}

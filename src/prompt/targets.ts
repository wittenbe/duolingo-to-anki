import type { PublishTarget } from "./publisher.js";
import type { UnitGrammar } from "../duolingo/guidebook.js";
import type { VocabItem } from "../duolingo/types.js";
import { seededRandom } from "../random.js";
import {
  dedupeConcepts,
  renderConceptDetails,
  renderConceptTitles,
  renderSpotlight,
  renderTitleList,
  renderVocabulary,
  renderWords,
  titleKey,
  type LeveledConcept,
} from "./render.js";

export interface Grammar {
  /** One entry per finished unit, in path order. */
  finished: UnitGrammar[];
  /** The unit in progress, if any. */
  current?: UnitGrammar;
  /** Units just ahead, whose grammar is off limits. */
  upcoming: UnitGrammar[];
}

const NONE = "- (none yet)";

const covered = (grammar?: Grammar) => (grammar ? dedupeConcepts(grammar.finished) : []);

/** Everything you know, for looking things up rather than drilling. */
export function referenceTarget(fileId: string, vocab: VocabItem[], grammar?: Grammar): PublishTarget {
  const concepts = covered(grammar);
  return {
    label: "vocabulary prompt",
    template: "template",
    fileId,
    required: "vocabulary",
    values: {
      vocabulary: renderVocabulary(vocab),
      grammar: concepts.length > 0 ? renderConceptDetails(concepts) : NONE,
    },
  };
}

export interface DailyTargetOptions {
  fileId: string;
  /** Today, as both the seed for the rotation and a line in the prompt. */
  seed: string;
  words: string[];
  grammar?: Grammar;
  spotlightCount: number;
}

/**
 * Today's drill: few words, wide grammar. The words are narrow on purpose, since a tutor cannot
 * hold 1900 of them in mind, while the grammar stays broad so the sessions keep varying — bounded
 * by what the course has actually taught.
 */
export function dailyTarget(options: DailyTargetOptions): PublishTarget {
  const concepts = covered(options.grammar);
  const titles = new Set(concepts.map((c) => titleKey(c.title)));
  const learningNow: LeveledConcept[] = options.grammar?.current
    ? dedupeConcepts([options.grammar.current], titles)
    : [];
  const upcoming = options.grammar
    ? dedupeConcepts(options.grammar.upcoming, new Set([...titles, ...learningNow.map((c) => titleKey(c.title))]))
    : [];

  return {
    label: "daily drill prompt",
    template: "daily",
    fileId: options.fileId,
    required: "words",
    values: {
      date: options.seed,
      words: renderWords(options.words),
      spotlight:
        concepts.length > 0
          ? renderSpotlight(concepts, options.spotlightCount, seededRandom(`spotlight:${options.seed}`))
          : NONE,
      learningNow: learningNow.length > 0 ? renderTitleList(learningNow) : NONE,
      concepts: concepts.length > 0 ? renderConceptTitles(concepts) : NONE,
      notCovered: upcoming.length > 0 ? renderTitleList(upcoming) : NONE,
    },
  };
}

import { z } from "zod";

// Verified against live API responses (2026-09-11, ~1600 learned words; re-checked 2026-10-12, 1919):
// - currentCourse.skills is an array of arrays (needs a .flat())
// - translations is a string array; it can temporarily come back empty for a word after some lessons

const SkillSchema = z.object({
  id: z.string(),
  finishedLessons: z.number(),
  finishedLevels: z.number(),
});

// A unit is one row on the path, with a guidebook holding its grammar tips. Verified 2026-10-12
// over all 303 units of the es/en course: every unit but the final checkpoint has a guidebook URL.
const UnitSchema = z.object({
  unitIndex: z.number(),
  teachingObjective: z.string().nullish(),
  levels: z.array(z.object({ state: z.string() })),
  guidebook: z.object({ url: z.string() }).nullish(),
});

const PathSectionSchema = z.object({
  index: z.number(),
  // e.g. { level: "A1", sublevel: 1 }; null on the final checkpoint section.
  cefr: z.object({ level: z.string(), sublevel: z.number().nullish() }).nullish(),
  units: z.array(UnitSchema),
});

export type PathSection = z.infer<typeof PathSectionSchema>;
export type Unit = z.infer<typeof UnitSchema>;

export const ProfileSchema = z.object({
  currentCourse: z.object({
    numberOfWords: z.number(),
    skills: z.array(z.array(SkillSchema)),
    // Grammar is a bonus, so a shape change here must not break the vocabulary sync:
    // on a parse failure this falls back to no sections, which callers report as a warning.
    pathSectioned: z.array(PathSectionSchema).catch([]),
  }),
});

export type Profile = z.infer<typeof ProfileSchema>;

const RawVocabItemSchema = z.object({
  text: z.string(),
  translations: z.array(z.string()),
  audioURL: z.string().optional(),
});

const PaginationSchema = z.object({
  totalLexemes: z.number(),
  nextStartIndex: z.number().nullable(),
});

export const LearnedLexemesResponseSchema = z.object({
  pagination: PaginationSchema,
  learnedLexemes: z.array(RawVocabItemSchema),
});

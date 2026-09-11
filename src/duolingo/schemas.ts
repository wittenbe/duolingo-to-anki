import { z } from "zod";

// Verified against live API responses (2026-09-11, ~1600 learned words):
// - currentCourse.skills is an array of arrays (needs a .flat())
// - translations is always a non-empty string array, never a bare string or null

const SkillSchema = z.object({
  id: z.string(),
  finishedLessons: z.number(),
  finishedLevels: z.number(),
});

export const ProfileSchema = z.object({
  currentCourse: z.object({
    numberOfWords: z.number(),
    skills: z.array(z.array(SkillSchema)),
  }),
});

const RawVocabItemSchema = z.object({
  text: z.string(),
  translations: z.array(z.string()).min(1),
});

const PaginationSchema = z.object({
  totalLexemes: z.number(),
  nextStartIndex: z.number().nullable(),
});

export const LearnedLexemesResponseSchema = z.object({
  pagination: PaginationSchema,
  learnedLexemes: z.array(RawVocabItemSchema),
});

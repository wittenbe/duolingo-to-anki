import { z } from "zod";
import { LearnedLexemesResponseSchema, ProfileSchema } from "./schemas.js";
import type { VocabItem } from "./types.js";

export interface DuolingoConfig {
  userId: string;
  token: string;
}

export interface FetchLearnedVocabOptions {
  log?: (message: string) => void;
}

const PAGE_SIZE = 100;

function headersFor(config: DuolingoConfig): HeadersInit {
  return {
    Authorization: config.token,
    "Content-Type": "application/json; charset=UTF-8",
    Accept: "application/json; charset=UTF-8",
  };
}

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, context: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`Unexpected Duolingo API response shape (${context}): ${result.error.message}`);
  }
  return result.data;
}

async function buildProgressedSkillsBody(config: DuolingoConfig) {
  const url = `https://www.duolingo.com/2023-05-23/users/${config.userId}?fields=currentCourse&_=${Date.now()}`;
  const res = await fetch(url, { headers: headersFor(config) });
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);

  const profile = parseOrThrow(ProfileSchema, await res.json(), "user profile");

  const progressedSkills = profile.currentCourse.skills
    .flat()
    .filter((s) => s.finishedLessons > 0 && s.finishedLevels > 0)
    .map((s) => ({
      skillId: { id: s.id },
      finishedLessons: s.finishedLessons,
      finishedLevels: s.finishedLevels,
    }));

  return { progressedSkills };
}

export async function fetchLearnedVocab(
  config: DuolingoConfig,
  options: FetchLearnedVocabOptions = {},
): Promise<VocabItem[]> {
  const log = options.log ?? (() => {});

  const body = await buildProgressedSkillsBody(config);
  log(`Built body: ${body.progressedSkills.length} skills`);

  let offset = 0;
  const all: VocabItem[] = [];

  while (true) {
    const url = `https://www.duolingo.com/2017-06-30/users/${config.userId}/courses/es/en/learned-lexemes?sortBy=LEARNED_DATE&startIndex=${offset}&limit=${PAGE_SIZE}`;
    const res = await fetch(url, {
      method: "POST",
      headers: headersFor(config),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

    const { learnedLexemes, pagination } = parseOrThrow(
      LearnedLexemesResponseSchema,
      await res.json(),
      `learned-lexemes page at offset ${offset}`,
    );

    if (learnedLexemes.length === 0) break;

    const items: VocabItem[] = learnedLexemes.filter(
      ({ text, translations }) => translations.length !== 1 || translations[0] !== text,
    );
    all.push(...items);
    log(`Fetched ${items.length} items (total: ${all.length} / ${pagination.totalLexemes})`);

    if (pagination.nextStartIndex == null) break;
    offset = pagination.nextStartIndex;
  }

  return all;
}

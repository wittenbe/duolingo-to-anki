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

const PAGE_SIZE = 500;

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

type ProgressedSkillsBody = Awaited<ReturnType<typeof buildProgressedSkillsBody>>;

// Results are ordered newest-learned first.
async function fetchLearnedLexemesPage(
  config: DuolingoConfig,
  body: ProgressedSkillsBody,
  startIndex: number,
  limit: number,
) {
  const url = `https://www.duolingo.com/2017-06-30/users/${config.userId}/courses/es/en/learned-lexemes?sortBy=LEARNED_DATE&startIndex=${startIndex}&limit=${limit}`;
  const res = await fetch(url, {
    method: "POST",
    headers: headersFor(config),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  return parseOrThrow(
    LearnedLexemesResponseSchema,
    await res.json(),
    `learned-lexemes page at offset ${startIndex}`,
  );
}

/** Cheap change detector: total learned count plus the most recently learned word. */
export async function fetchVocabFingerprint(config: DuolingoConfig): Promise<string> {
  const body = await buildProgressedSkillsBody(config);
  const { learnedLexemes, pagination } = await fetchLearnedLexemesPage(config, body, 0, 1);
  return `${pagination.totalLexemes}:${learnedLexemes[0]?.text ?? ""}`;
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
    const { learnedLexemes, pagination } = await fetchLearnedLexemesPage(config, body, offset, PAGE_SIZE);

    if (learnedLexemes.length === 0) break;

    all.push(...learnedLexemes.map(({ text, translations, audioURL }) => ({ text, translations, audioUrl: audioURL })));
    log(`Fetched ${learnedLexemes.length} items (total: ${all.length} / ${pagination.totalLexemes})`);

    if (pagination.nextStartIndex == null) break;
    offset = pagination.nextStartIndex;
  }

  return all;
}

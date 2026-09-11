import { writeFileSync } from "fs";
import type { VocabItem } from "./duolingo/types.js";

const PROMPT = `\
You are a Spanish language tutor. Using ONLY the vocabulary words listed below, \
generate a challenging English sentence for me to translate into Spanish.
After I present my answer, correct any mistakes and then give me another one.
Respond and give feedback in English.

It is important that you only use words from this list, though minor changes are of course ok
(e.g. if compartir is present, any other conjugation is fair game)

Assume that I reply via voice, so any missing punctuation or accents are a consequence of that,
and you don't have to correct that.

---
VOCABULARY:`;

export function writeVocabFile(items: VocabItem[], filePath: string): void {
  const words = items.map((v) => v.text).join("\n");
  const content = `${PROMPT}\n${words}\n`;
  writeFileSync(filePath, content, "utf-8");
  console.log(`Wrote ${items.length} words to ${filePath}`);
}

import type { AnkiClient } from "./client.js";

export const NOTE_TYPE_NAME = "Duolingo Spanish";

// Spanish is the first field: Anki uses it as the note's identity for duplicate checks.
export interface NoteFields {
  Spanish: string;
  English: string;
  AlsoAccepted: string;
  Audio: string;
}

const FIELD_NAMES: (keyof NoteFields)[] = ["Spanish", "English", "AlsoAccepted", "Audio"];

const CSS = `.card {
  font-family: arial;
  font-size: 24px;
  line-height: 1.5;
  text-align: center;
}
.spanish { font-size: 30px; font-weight: bold; }
.also { font-size: 18px; opacity: 0.65; margin-top: 12px; }`;

export const TEMPLATE_EN_ES = "English → Spanish";
export const TEMPLATE_ES_EN = "Spanish → English";

const TEMPLATES = [
  {
    Name: TEMPLATE_EN_ES,
    Front: `<div class="english">{{English}}</div>`,
    Back: `{{FrontSide}}
<hr id="answer">
<div class="spanish">{{Spanish}}</div>
{{#AlsoAccepted}}<div class="also">also accepted: {{AlsoAccepted}}</div>{{/AlsoAccepted}}
{{Audio}}`,
  },
  {
    Name: TEMPLATE_ES_EN,
    Front: `<div class="spanish">{{Spanish}}</div>
{{Audio}}`,
    Back: `{{FrontSide}}
<hr id="answer">
<div class="english">{{English}}</div>`,
  },
];

// Adding a template to an existing note type is a schema change: the next AnkiWeb sync must be a full upload.
export async function ensureNoteType(anki: AnkiClient): Promise<void> {
  const models = await anki.request<string[]>("modelNames");
  if (!models.includes(NOTE_TYPE_NAME)) {
    await anki.request("createModel", {
      modelName: NOTE_TYPE_NAME,
      inOrderFields: FIELD_NAMES,
      isCloze: false,
      css: CSS,
      cardTemplates: TEMPLATES,
    });
    console.log(`Created note type: "${NOTE_TYPE_NAME}"`);
    return;
  }

  const existing = await anki.request<Record<string, unknown>>("modelTemplates", { modelName: NOTE_TYPE_NAME });
  for (const template of TEMPLATES.filter((t) => !(t.Name in existing))) {
    await anki.request("modelTemplateAdd", { modelName: NOTE_TYPE_NAME, template });
    console.log(`Added card template "${template.Name}" to "${NOTE_TYPE_NAME}"`);
  }
}

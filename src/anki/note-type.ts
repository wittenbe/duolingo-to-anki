import type { AnkiClient } from "./client.js";

export const NOTE_TYPE_NAME = "Duolingo Spanish";

// Spanish is the first field: Anki uses it as the note's identity for duplicate checks.
// Notes is yours to fill in: the poller never reads or writes it, so it survives every update.
export interface NoteFields {
  Spanish: string;
  English: string;
  AlsoAccepted: string;
  Audio: string;
}

const FIELD_NAMES = ["Spanish", "English", "AlsoAccepted", "Audio", "Notes"];

const CSS = `.card {
  font-family: arial;
  font-size: 24px;
  line-height: 1.5;
  text-align: center;
}
.spanish { font-size: 30px; font-weight: bold; }
.also { font-size: 18px; opacity: 0.65; margin-top: 12px; }
.notes { font-size: 18px; opacity: 0.8; margin-top: 12px; font-style: italic; }`;

export const TEMPLATE_EN_ES = "English → Spanish";
export const TEMPLATE_ES_EN = "Spanish → English";

// The notes go on the English → Spanish front, where an unclear translation is the problem,
// and on the Spanish → English back, where it is just extra context.
const TEMPLATES = [
  {
    Name: TEMPLATE_EN_ES,
    Front: `<div class="english">{{English}}</div>
{{#Notes}}<div class="notes">{{Notes}}</div>{{/Notes}}`,
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
<div class="english">{{English}}</div>
{{#Notes}}<div class="notes">{{Notes}}</div>{{/Notes}}`,
  },
];

/**
 * Creates the note type, or brings an existing one up to date.
 *
 * Returns true if anything changed, so the caller can sync it to AnkiWeb. Adding a field
 * is a schema change: the next AnkiWeb sync must be a full upload, done by hand over VNC.
 * Changing a template's HTML or the styling is not, and syncs normally.
 */
export async function ensureNoteType(anki: AnkiClient): Promise<boolean> {
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
    return true;
  }

  let changed = false;

  const fields = await anki.request<string[]>("modelFieldNames", { modelName: NOTE_TYPE_NAME });
  for (const fieldName of FIELD_NAMES.filter((f) => !fields.includes(f))) {
    await anki.request("modelFieldAdd", { modelName: NOTE_TYPE_NAME, fieldName });
    console.log(
      `Added field "${fieldName}" to "${NOTE_TYPE_NAME}". This is a schema change: ` +
        `the next AnkiWeb sync needs a full upload, see the README.`,
    );
    changed = true;
  }

  const { css } = await anki.request<{ css: string }>("modelStyling", { modelName: NOTE_TYPE_NAME });
  if (css !== CSS) {
    await anki.request("updateModelStyling", { model: { name: NOTE_TYPE_NAME, css: CSS } });
    console.log(`Updated the styling of "${NOTE_TYPE_NAME}"`);
    changed = true;
  }

  const existing = await anki.request<Record<string, { Front: string; Back: string }>>("modelTemplates", {
    modelName: NOTE_TYPE_NAME,
  });

  for (const template of TEMPLATES.filter((t) => !(t.Name in existing))) {
    await anki.request("modelTemplateAdd", { modelName: NOTE_TYPE_NAME, template });
    console.log(`Added card template "${template.Name}" to "${NOTE_TYPE_NAME}"`);
    changed = true;
  }

  const outdated = TEMPLATES.filter(
    (t) => t.Name in existing && (existing[t.Name].Front !== t.Front || existing[t.Name].Back !== t.Back),
  );
  if (outdated.length > 0) {
    await anki.request("updateModelTemplates", {
      model: {
        name: NOTE_TYPE_NAME,
        templates: Object.fromEntries(outdated.map((t) => [t.Name, { Front: t.Front, Back: t.Back }])),
      },
    });
    for (const t of outdated) console.log(`Updated card template "${t.Name}" of "${NOTE_TYPE_NAME}"`);
    changed = true;
  }

  return changed;
}

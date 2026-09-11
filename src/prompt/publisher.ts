import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { DriveClient } from "../google/drive.js";

const PLACEHOLDER = "{{vocabulary}}";

export interface PromptPublisherOptions {
  templateDir: string;
  drive: { client: DriveClient; fileId: string };
}

export interface PromptPublisher {
  setVocabulary(words: string[]): void;
  publishIfChanged(): Promise<void>;
}

export function createPromptPublisher(options: PromptPublisherOptions): PromptPublisher {
  let words: string[] | undefined;
  let lastPublished: string | undefined;

  function templatePath(): string {
    const custom = join(options.templateDir, "template.md");
    return existsSync(custom) ? custom : join(options.templateDir, "template.example.md");
  }

  // Re-reads the template on every call, so edits apply without a restart.
  function render(vocabulary: string[]): string {
    const path = templatePath();
    const template = readFileSync(path, "utf-8");
    if (!template.includes(PLACEHOLDER)) throw new Error(`${path} has no ${PLACEHOLDER} placeholder`);
    return template.replace(PLACEHOLDER, () => vocabulary.join("\n"));
  }

  return {
    setVocabulary(newWords) {
      words = newWords;
    },

    async publishIfChanged() {
      if (!words) return;
      const content = render(words);
      if (content === lastPublished) return;

      const uploaded = await options.drive.client.updateFileIfChanged(options.drive.fileId, content);
      console.log(uploaded ? "Uploaded vocabulary prompt to Google Drive" : "Google Drive prompt already up to date");
      lastPublished = content;
    },
  };
}

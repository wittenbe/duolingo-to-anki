import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { DriveClient } from "../google/drive.js";

export interface PublishTarget {
  /** Shown in log lines, e.g. "vocabulary prompt". */
  label: string;
  /** Base name under the template directory: `<name>.md`, falling back to `<name>.example.md`. */
  template: string;
  /** Google Drive file to overwrite. */
  fileId: string;
  /** A placeholder the template must contain, as a guard against a mistyped template. */
  required: string;
  /** Placeholder name (without braces) to replacement text. */
  values: Record<string, string>;
}

export interface PromptPublisherOptions {
  templateDir: string;
  drive: DriveClient;
}

export interface PromptPublisher {
  setTargets(targets: PublishTarget[]): void;
  publishIfChanged(): Promise<void>;
}

const placeholder = (name: string) => `{{${name}}}`;

export function createPromptPublisher(options: PromptPublisherOptions): PromptPublisher {
  let targets: PublishTarget[] = [];
  const lastPublished = new Map<string, string>();

  function templatePath(name: string): string {
    const custom = join(options.templateDir, `${name}.md`);
    return existsSync(custom) ? custom : join(options.templateDir, `${name}.example.md`);
  }

  // Re-reads the template on every call, so edits apply without a restart.
  function render(target: PublishTarget): string {
    const path = templatePath(target.template);
    const template = readFileSync(path, "utf-8");
    if (!template.includes(placeholder(target.required))) {
      throw new Error(`${path} has no ${placeholder(target.required)} placeholder`);
    }

    // A placeholder the template leaves out is simply not rendered, so a custom template can drop
    // any section it doesn't want.
    return Object.entries(target.values).reduce(
      (text, [name, value]) => text.replaceAll(placeholder(name), () => value),
      template,
    );
  }

  return {
    setTargets(newTargets) {
      targets = newTargets;
    },

    async publishIfChanged() {
      for (const target of targets) {
        const content = render(target);
        if (content === lastPublished.get(target.fileId)) continue;

        const uploaded = await options.drive.updateFileIfChanged(target.fileId, content);
        console.log(uploaded ? `Uploaded the ${target.label} to Google Drive` : `Google Drive ${target.label} already up to date`);
        lastPublished.set(target.fileId, content);
      }
    },
  };
}

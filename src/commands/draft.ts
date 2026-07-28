import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readAiEnv } from "../core/env.js";
import {
  OpenRouterClient,
  OpenRouterError,
  formatUsd,
} from "../core/openrouter.js";
import { collectProjectContext } from "../core/context.js";
import { draftDocument } from "../core/draft.js";
import { safeJoin } from "../core/paths.js";

export interface DraftFlags {
  topic: string;
  dir: string;
  /** Directory to write into. Defaults to the project directory. */
  output?: string;
  about?: string;
  /** Print to stdout instead of writing a file. */
  print: boolean;
  force: boolean;
  model?: string;
}

/** `Incident Response` -> `incident-response` */
function slugify(topic: string): string {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") throw new Error("that topic has no usable filename in it");
  return slug;
}

export async function draftCommand(flags: DraftFlags): Promise<number> {
  const slug = slugify(flags.topic);
  const base = flags.output ?? flags.dir;
  const relative = `docs/${slug}.md`;
  const target = safeJoin(base, relative);

  console.log(
    `\ntison draft ${flags.topic}  ->  ${flags.print ? "(stdout)" : relative}\n`,
  );

  if (!flags.print && existsSync(target) && !flags.force) {
    console.log(
      `${relative} already exists. Use --force to overwrite, or --print to preview.`,
    );
    return 1;
  }

  let env;
  try {
    env = readAiEnv({ model: flags.model, dir: flags.dir });
  } catch (err) {
    console.log(`${(err as Error).message}`);
    return 1;
  }

  const context = collectProjectContext(flags.dir);
  console.log(`  Model: ${env.model}`);
  console.log(
    `  Project context: ${context.files.length} manifest(s), ~${context.approxTokens} tokens`,
  );
  console.log("  drafting…\n");

  try {
    const result = await draftDocument({
      client: new OpenRouterClient(env),
      context,
      topic: flags.topic,
      about: flags.about,
    });

    for (const note of result.dropped) {
      console.log(`  dropped: ${note}`);
    }

    if (result.slotCount === 0) {
      console.log(
        "  Nothing usable came back — no blanks at all.\n" +
          "  Nothing was written. Try a more specific topic, or use --about to say\n" +
          "  what varies between projects for this kind of document.",
      );
      console.log(`\nCost: ${formatUsd(result.costUsd)}`);
      return 1;
    }

    if (flags.print) {
      console.log("----------------------------------------");
      process.stdout.write(result.markdown);
      console.log("----------------------------------------");
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, result.markdown);
      console.log(`  + ${relative}`);
    }

    const lines = result.markdown.split("\n").length;
    console.log(
      `\n${result.doc.sections.length} section(s), ${result.slotCount} blank(s), ${lines} lines.`,
    );
    console.log(`Cost: ${formatUsd(result.costUsd)}`);

    if (!flags.print) {
      console.log(
        "\nThis is a skeleton, not a document. Run `tison fill` to answer what your\n" +
          "repo can, then write the rules and procedures yourself — that's the part\n" +
          "that helps an agent, and the part a model can't know.",
      );
    }

    return 0;
  } catch (err) {
    if (err instanceof OpenRouterError) {
      console.log(`  failed  [${err.kind}] ${err.message}`);
      return 1;
    }
    throw err;
  }
}

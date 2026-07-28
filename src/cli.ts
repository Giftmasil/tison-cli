#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCommand } from "./commands/run.js";
import { generateCommand } from "./commands/generate.js";
import { listCommand } from "./commands/list.js";
import { validateCommand } from "./commands/validate.js";
import { doctorCommand } from "./commands/doctor.js";
import { fillCommand } from "./commands/fill.js";
import { draftCommand } from "./commands/draft.js";

// Read the version from the manifest rather than restating it here, so a
// `npm version` bump can't leave `tison --version` reporting a lie.
// Compiled to dist/cli.js, so package.json is one level up.
const { version } = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "..", "package.json"), "utf8"),
) as { version: string };

const program = new Command();

program
  .name("tison")
  .description(
    "Scaffold curated AI-context files (AGENTS.md, CLAUDE.md, specs) into a project\n" +
      "from hand-crafted, category-specific templates.",
  )
  .version(version, "-V, --version", "show the installed version")
  .showHelpAfterError('(run "tison --help" to see usage)')
  .showSuggestionAfterError();

program
  .command("run")
  .summary("scaffold a whole template set into your project")
  .description(
    "Scaffold every file in a template category into your project at once.",
  )
  .argument(
    "<category>",
    "which set to apply — run `tison list` to see them (e.g. mvp, enterprise)",
  )
  .option("-o, --output <dir>", "directory to write into", ".")
  .option("-f, --force", "overwrite files that already exist", false)
  .option(
    "-d, --dry-run",
    "preview what would be written, without writing anything",
    false,
  )
  .option(
    "-y, --yes",
    "don't ask where to put things; use the directory given",
    false,
  )
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  tison run mvp                 scaffold the lean MVP set here",
      "  tison run enterprise          scaffold the full production set",
      "  tison run mvp --dry-run       preview only, write nothing",
      "  tison run mvp --force         overwrite files that already exist",
      "  tison run mvp -o ./my-app     write into ./my-app instead of here",
    ].join("\n"),
  )
  .action(
    async (
      category: string,
      opts: { output: string; force: boolean; dryRun: boolean; yes: boolean },
    ) => {
      try {
        await runCommand(category, {
          output: resolve(opts.output),
          force: opts.force,
          dryRun: opts.dryRun,
          yes: opts.yes,
        });
      } catch (err) {
        program.error(`tison: ${(err as Error).message}`, { exitCode: 1 });
      }
    },
  );

program
  .command("generate")
  .summary("add a single doc from a set into your project")
  .description("Apply one file from a category, instead of the whole set.")
  .argument(
    "<doc>",
    "which doc — see the `docs:` line in `tison list` (e.g. testing, conventions)",
  )
  .option("-c, --category <category>", "which set the doc comes from", "mvp")
  .option("-o, --output <dir>", "directory to write into", ".")
  .option("-f, --force", "overwrite if it already exists", false)
  .option(
    "-d, --dry-run",
    "preview what would be written, without writing anything",
    false,
  )
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  tison generate conventions                    add conventions.md (from mvp)",
      "  tison generate testing --category enterprise  add the enterprise testing.md",
      "  tison generate architecture -c enterprise     add the enterprise architecture.md",
    ].join("\n"),
  )
  .action(
    (
      doc: string,
      opts: {
        category: string;
        output: string;
        force: boolean;
        dryRun: boolean;
      },
    ) => {
      try {
        generateCommand(doc, {
          category: opts.category,
          output: resolve(opts.output),
          force: opts.force,
          dryRun: opts.dryRun,
        });
      } catch (err) {
        program.error(`tison: ${(err as Error).message}`, { exitCode: 1 });
      }
    },
  );

program
  .command("list")
  .summary("show available template sets and what's in each")
  .description("List every template category and the docs it contains.")
  .action(() => {
    listCommand();
  });

program
  .command("validate")
  .summary("check context files for unfilled placeholders, bloat, and secrets")
  .description(
    "Scan AGENTS.md, CLAUDE.md, docs/, and .claude/ for common problems.",
  )
  .argument("[path]", "directory to scan", ".")
  .option("-s, --strict", "treat warnings as failures (good for CI)", false)
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  tison validate                 check the current project",
      "  tison validate ./my-app        check another directory",
      "  tison validate --strict        fail on warnings too (for CI)",
    ].join("\n"),
  )
  .action((path: string, opts: { strict: boolean }) => {
    try {
      process.exitCode = validateCommand({
        dir: resolve(path),
        strict: opts.strict,
      });
    } catch (err) {
      program.error(`tison: ${(err as Error).message}`, { exitCode: 1 });
    }
  });

program
  .command("doctor")
  .summary("check that the AI features are configured and reachable")
  .description(
    "Verify the OpenRouter key, model, and network path by making one tiny\n" +
      "structured-output call. Costs a fraction of a cent.",
  )
  .option(
    "-m, --model <slug>",
    "check a specific model instead of the configured one",
  )
  .option("--offline", "check configuration only — make no network call", false)
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  tison doctor                          check the configured model",
      "  tison doctor --offline                check config without spending anything",
      "  tison doctor -m minimax/minimax-m2.5  try a different model",
      "",
      "Set OPENROUTER_API_KEY in a .env file (gitignored) or your shell.",
      "Optionally set TISON_MODEL to change the default model.",
    ].join("\n"),
  )
  .action(async (opts: { model?: string; offline: boolean }) => {
    try {
      process.exitCode = await doctorCommand({
        model: opts.model,
        offline: opts.offline,
      });
    } catch (err) {
      program.error(`tison: ${(err as Error).message}`, { exitCode: 1 });
    }
  });

program
  .command("fill")
  .summary("fill [TODO(tison)] markers by reading your project")
  .description(
    "Read the project's manifests and file tree, then fill the placeholder\n" +
      "markers in AGENTS.md, CLAUDE.md, docs/, and .claude/. Markers the project\n" +
      "can't answer are left in place for you.",
  )
  .argument("[path]", "project directory", ".")
  .option(
    "--file <path...>",
    "only fill these files (relative to the project root)",
  )
  .option(
    "-d, --dry-run",
    "show what would be sent — no call, no writes, no cost",
    false,
  )
  .option(
    "-m, --model <slug>",
    "use a specific model instead of the configured one",
  )
  .option("--max-tokens <n>", "ceiling on each reply", (v: string) =>
    Number.parseInt(v, 10),
  )
  .option(
    "-v, --verbose",
    "show every slot and exactly what the model returned",
    false,
  )
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  tison fill --dry-run              see what would be filled, for free",
      "  tison fill                        fill this project",
      "  tison fill ./my-app               fill another project",
      "  tison fill --file AGENTS.md       fill just one document",
      "  tison fill --verbose              show what came back for every slot",
      "",
      "Safe to re-run: a filled marker is gone, so only what's left gets sent.",
      "Requires OPENROUTER_API_KEY — run `tison doctor` first if unsure.",
    ].join("\n"),
  )
  .action(
    async (
      path: string,
      opts: {
        file?: string[];
        dryRun: boolean;
        model?: string;
        maxTokens?: number;
        verbose: boolean;
      },
    ) => {
      try {
        process.exitCode = await fillCommand({
          dir: resolve(path),
          only: opts.file,
          dryRun: opts.dryRun,
          model: opts.model,
          maxTokens: opts.maxTokens,
          verbose: opts.verbose,
        });
      } catch (err) {
        program.error(`tison: ${(err as Error).message}`, { exitCode: 1 });
      }
    },
  );

program
  .command("draft")
  .summary("design a new doc type that no template covers")
  .description(
    "Have a model design the STRUCTURE of a new context document — sections and\n" +
      "[TODO(tison)] slots, never facts about your project. Fill the slots with\n" +
      "`tison fill`, then edit it yourself.",
  )
  .argument(
    "<topic>",
    'what the doc covers, e.g. "deployment" or "incident response"',
  )
  .argument("[path]", "project directory", ".")
  .option("--about <text>", "extra steer on what the doc should cover")
  .option(
    "-o, --output <dir>",
    "directory to write into (default: the project directory)",
  )
  .option("-p, --print", "print the draft instead of writing it", false)
  .option("-f, --force", "overwrite if the file already exists", false)
  .option(
    "-m, --model <slug>",
    "use a specific model instead of the configured one",
  )
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  tison draft deployment --print         preview without writing",
      "  tison draft deployment                 write docs/deployment.md",
      '  tison draft "incident response"        write docs/incident-response.md',
      "  tison draft deployment -o ./site       write into ./site/docs instead",
      "",
      "The model designs the shape; your repo supplies the values; you approve both.",
      "It will refuse to write a draft that came back with no slots.",
    ].join("\n"),
  )
  .action(
    async (
      topic: string,
      path: string,
      opts: {
        about?: string;
        output?: string;
        print: boolean;
        force: boolean;
        model?: string;
      },
    ) => {
      try {
        process.exitCode = await draftCommand({
          topic,
          dir: resolve(path),
          output: opts.output ? resolve(opts.output) : undefined,
          about: opts.about,
          print: opts.print,
          force: opts.force,
          model: opts.model,
        });
      } catch (err) {
        program.error(`tison: ${(err as Error).message}`, { exitCode: 1 });
      }
    },
  );

program.addHelpText(
  "after",
  [
    "",
    "Examples:",
    "  tison list                     see the available sets and what's in each",
    "  tison run mvp                  scaffold the lean MVP set here",
    "  tison run enterprise           scaffold the full production set",
    "  tison generate testing -c enterprise   add just one doc to an existing project",
    "  tison run mvp --dry-run        preview without writing anything",
    "  tison doctor                   check that the AI features are wired up",
    "  tison fill --dry-run           see which markers an AI pass would fill",
    "  tison draft deployment -p      design a doc type no template covers",
    "",
    'Note: the command comes first, then the category — "tison run mvp", not "tison mvp run".',
    "Files are written into the current directory unless you pass --output.",
  ].join("\n"),
);

// An unawaited parseAsync turns any escaped rejection into an unhandled
// rejection warning and an opaque stack trace. Catch it and fail like a CLI.
program.parseAsync().catch((err: unknown) => {
  console.error(`tison: ${(err as Error).message}`);
  process.exitCode = 1;
});

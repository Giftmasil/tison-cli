#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { runCommand } from "./commands/run.js";
import { generateCommand } from "./commands/generate.js";
import { listCommand } from "./commands/list.js";
import { validateCommand } from "./commands/validate.js";

const program = new Command();

program
  .name("tison")
  .description(
    "Scaffold curated AI-context files (AGENTS.md, CLAUDE.md, specs) into a project\n" +
      "from hand-crafted, category-specific templates."
  )
  .version("0.1.0", "-V, --version", "show the installed version")
  .showHelpAfterError('(run "tison --help" to see usage)')
  .showSuggestionAfterError();

program
  .command("run")
  .summary("scaffold a whole template set into your project")
  .description("Scaffold every file in a template category into your project at once.")
  .argument("<category>", "which set to apply — run `tison list` to see them (e.g. mvp, enterprise)")
  .option("-o, --output <dir>", "directory to write into", ".")
  .option("-f, --force", "overwrite files that already exist", false)
  .option("-d, --dry-run", "preview what would be written, without writing anything", false)
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
    ].join("\n")
  )
  .action((category: string, opts: { output: string; force: boolean; dryRun: boolean }) => {
    try {
      runCommand(category, {
        output: resolve(opts.output),
        force: opts.force,
        dryRun: opts.dryRun,
      });
    } catch (err) {
      program.error(`tison: ${(err as Error).message}`, { exitCode: 1 });
    }
  });

program
  .command("generate")
  .summary("add a single doc from a set into your project")
  .description("Apply one file from a category, instead of the whole set.")
  .argument("<doc>", "which doc — see the `docs:` line in `tison list` (e.g. testing, conventions)")
  .option("-c, --category <category>", "which set the doc comes from", "mvp")
  .option("-o, --output <dir>", "directory to write into", ".")
  .option("-f, --force", "overwrite if it already exists", false)
  .option("-d, --dry-run", "preview what would be written, without writing anything", false)
  .addHelpText(
    "after",
    [
      "",
      "Examples:",
      "  tison generate conventions                    add conventions.md (from mvp)",
      "  tison generate testing --category enterprise  add the enterprise testing.md",
      "  tison generate architecture -c enterprise     add the enterprise architecture.md",
    ].join("\n")
  )
  .action(
    (doc: string, opts: { category: string; output: string; force: boolean; dryRun: boolean }) => {
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
    }
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
  .description("Scan AGENTS.md, CLAUDE.md, docs/, and .claude/ for common problems.")
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
    ].join("\n")
  )
  .action((path: string, opts: { strict: boolean }) => {
    try {
      process.exitCode = validateCommand({ dir: resolve(path), strict: opts.strict });
    } catch (err) {
      program.error(`tison: ${(err as Error).message}`, { exitCode: 1 });
    }
  });

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
    "",
    'Note: the command comes first, then the category — "tison run mvp", not "tison mvp run".',
    "Files are written into the current directory unless you pass --output.",
  ].join("\n")
);

program.parseAsync();

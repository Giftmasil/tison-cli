import { join, relative } from "node:path";
import { applyDocs } from "../core/apply.js";
import { report } from "../core/report.js";
import {
  detectProjects,
  isMisplaced,
  describeProject,
} from "../core/detect.js";
import { choose, isInteractive } from "../core/prompt.js";

export interface RunFlags {
  output: string;
  force: boolean;
  dryRun: boolean;
  /** Skip the "where should these go" question and use the given directory. */
  yes: boolean;
}

/**
 * Decide where the context files belong, out loud.
 *
 * Both answers are legitimate. A root `AGENTS.md` covers the whole repository
 * and is what an agent opening the repo reads first; a nested one sits beside
 * the code and wins under "nearest file" resolution. What isn't legitimate is
 * picking silently, then leaving someone to work out later why nothing was
 * found — so when the app clearly isn't where the command was pointed, ask.
 */
async function resolveTarget(requested: string, yes: boolean): Promise<string> {
  const projects = detectProjects(requested);

  if (projects.length === 0) {
    console.log(
      "  Note: no project manifest found here (package.json, pyproject.toml, go.mod, …).",
    );
    console.log(
      "  Scaffolding anyway — but check you're in the right directory.\n",
    );
    return requested;
  }

  if (!isMisplaced(projects)) return requested;

  const nested = projects.filter((p) => p.dir !== "");

  console.log("  No project manifest here. Found one under:\n");
  for (const project of nested) console.log(`    ${describeProject(project)}`);
  console.log("");

  if (yes || !isInteractive()) {
    console.log(
      "  Writing to the directory you gave. Pass --output to change it.\n",
    );
    return requested;
  }

  const target = await choose("Where should the context files go?", [
    {
      label: `${nested[0]!.dir}/  — beside the code an agent will edit`,
      value: join(requested, nested[0]!.dir),
      detail: "Agents read the nearest file to what they're changing.",
    },
    {
      label: "here  — one file covering the whole repository",
      value: requested,
      detail: "What an agent opening the repo root sees first.",
    },
    ...nested.slice(1).map((project) => ({
      label: `${project.dir}/`,
      value: join(requested, project.dir),
    })),
  ]);

  console.log("");
  return target;
}

export async function runCommand(
  category: string,
  flags: RunFlags,
): Promise<void> {
  console.log(`\ntison run ${category}\n`);

  const output = await resolveTarget(flags.output, flags.yes);

  const results = applyDocs({
    category,
    outDir: output,
    force: flags.force,
    dryRun: flags.dryRun,
  });

  console.log(`  ->  ${output}\n`);
  report(results, flags.dryRun);

  if (!flags.dryRun && results.some((r) => r.status !== "skipped")) {
    // Name the directory we actually wrote to. Suggesting a bare `tison fill`
    // after scaffolding into a subfolder sends the user to a "nothing to fill"
    // message with no clue why.
    const where = relative(flags.output, output).replace(/\\/g, "/");
    const target = where === "" ? "" : `${where} `;
    console.log(
      `\nNext: \`tison fill ${target}--dry-run\` to see what can be filled from your project.`,
    );
  }
}

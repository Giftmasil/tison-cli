import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Work out where the actual project is, so a command can say so out loud.
 *
 * Plenty of repos keep the app one level down - `client/`, `app/`, `web/`,
 * `server/` - with only a README at the top. Scaffolding into such a repo isn't
 * wrong, but doing it without a word leaves someone staring at a run that found
 * nothing and no clue why. Detection exists to make that visible before it
 * costs anyone anything.
 */

/** Manifests that mark the root of a real project. */
const MANIFESTS = [
  "package.json",
  "deno.json",
  "deno.jsonc",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "composer.json",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "mix.exs",
  "pubspec.yaml",
];

export const LOCKFILES: Record<string, string> = {
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
  "bun.lockb": "bun",
  "bun.lock": "bun",
  "poetry.lock": "poetry",
  "uv.lock": "uv",
  "Pipfile.lock": "pipenv",
  "Gemfile.lock": "bundler",
  "Cargo.lock": "cargo",
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-test",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  "vendor",
  "target",
  "venv",
  ".venv",
  "__pycache__",
  ".idea",
  ".vscode",
  "docs",
  ".claude",
]);

export interface DetectedProject {
  /** Relative directory, or "" for the repository root. */
  dir: string;
  /** The manifest filename that identified it. */
  manifest: string;
  packageManager?: string;
}

function inspect(absolute: string, dir: string): DetectedProject | undefined {
  let names: string[];
  try {
    names = readdirSync(absolute);
  } catch {
    return undefined;
  }

  const manifest = MANIFESTS.find((m) => names.includes(m));
  if (!manifest) return undefined;

  const lockfile = names.find((n) => n in LOCKFILES);
  return {
    dir,
    manifest,
    packageManager: lockfile ? LOCKFILES[lockfile] : undefined,
  };
}

/**
 * Projects at the root, then one level down. Root comes first when both exist,
 * because a repository-level manifest is the more authoritative answer.
 */
export function detectProjects(root: string): DetectedProject[] {
  const found: DetectedProject[] = [];

  const atRoot = inspect(root, "");
  if (atRoot) found.push(atRoot);

  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      SKIP_DIRS.has(entry.name)
    )
      continue;
    const nested = inspect(join(root, entry.name), entry.name);
    if (nested) found.push(nested);
  }

  return found;
}

/** True when the directory holds no manifest of its own but something below does. */
export function isMisplaced(projects: DetectedProject[]): boolean {
  return projects.length > 0 && !projects.some((p) => p.dir === "");
}

/** Human-readable one-liner for a detected project. */
export function describeProject(project: DetectedProject): string {
  const where = project.dir === "" ? "here" : `${project.dir}/`;
  const manager = project.packageManager ? `, ${project.packageManager}` : "";
  return `${where}  (${project.manifest}${manager})`;
}

/** Does this directory look like a project at all? */
export function looksLikeRepo(dir: string): boolean {
  return (
    existsSync(join(dir, ".git")) && statSync(join(dir, ".git")).isDirectory()
  );
}

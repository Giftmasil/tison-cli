import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Reads enough of a project for a model to answer "what is the test command
 * here" without reading the whole repo.
 *
 * Two rules shape this file. Everything is bounded, because an unbounded packer
 * quietly turns a one-cent run into a six-dollar one, and the research this
 * tool rests on found that extra context makes models worse rather than better.
 * And discovery is driven by *shape* rather than by a list of names — a
 * hardcoded `prisma/schema.prisma` serves Prisma users and silently fails
 * everyone on Drizzle, Knex, TypeORM, Alembic, or ActiveRecord.
 */

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-test",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
  ".turbo",
  ".cache",
  "vendor",
  "target",
  "venv",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".idea",
  ".vscode",
  "tmp",
  "temp",
]);

interface Source {
  /** Matched against the POSIX-style path relative to the project root. */
  re: RegExp;
  maxChars: number;
  /** How many matches of this kind to take. */
  limit: number;
}

/**
 * Allow a single directory prefix on a root-level pattern.
 *
 * Plenty of repos keep the app one level down — `client/`, `app/`, `web/`,
 * `frontend/`, `server/` — with nothing but a README at the top. Anchoring
 * manifests to the root makes every one of those look like an empty project.
 * One level is enough to cover the common case without dragging in every
 * package of a large monorepo.
 *
 * The tree is walked breadth-first, so a root manifest is always seen before a
 * nested one and wins the limit when both exist.
 */
function nested(pattern: string): RegExp {
  return new RegExp(`^([^/]+/)?(${pattern})$`, "i");
}

/**
 * What to read, in priority order — the budget is spent top-down, so on a
 * project big enough to exhaust it the most useful sources are the survivors.
 *
 * The ordering is also why a README outranks a build config: it is the only
 * place that answers "what is this service and what role does it play", and no
 * manifest ever will.
 */
const SOURCES: Source[] = [
  // Commands, dependencies, package manager. The single highest-value file.
  { re: nested("package\\.json|deno\\.jsonc?"), maxChars: 6_000, limit: 2 },

  // What the project *is*. Nothing else answers this.
  { re: nested("readme(\\.md|\\.rst|\\.txt)?"), maxChars: 3_000, limit: 2 },

  // Branch naming, PR rules, review norms.
  { re: nested("contributing\\.md"), maxChars: 2_500, limit: 1 },

  // Other language manifests.
  {
    re: nested(
      "pyproject\\.toml|requirements\\.txt|go\\.mod|Cargo\\.toml|composer\\.json|Gemfile|pom\\.xml|build\\.gradle(\\.kts)?|mix\\.exs|pubspec\\.yaml",
    ),
    maxChars: 4_000,
    limit: 3,
  },

  // The CI-gates marker asks what must pass before merge. This is where it lives.
  { re: /^\.github\/workflows\/[^/]+\.ya?ml$/, maxChars: 2_000, limit: 2 },

  // Workspace and monorepo layout.
  {
    re: nested(
      "pnpm-workspace\\.yaml|turbo\\.json|nx\\.json|lerna\\.json|tsconfig\\.json",
    ),
    maxChars: 2_000,
    limit: 3,
  },

  // Any root-level *.config.* — catches next, vite, vitest, drizzle, tailwind,
  // eslint, playwright, astro, and whatever ships next year, without naming any.
  {
    re: nested("[^/]+\\.config\\.(ts|js|mjs|cjs|json|yaml|yml)"),
    maxChars: 1_500,
    limit: 5,
  },

  // Tooling configs that are manifest-shaped but carry no `.config.` in the
  // name — shadcn's components.json names the whole component library and its
  // path aliases, and matched nothing until now.
  {
    re: nested(
      "components\\.json|biome\\.jsonc?|\\.eslintrc(\\.json|\\.js|\\.cjs|\\.ya?ml)?|\\.prettierrc(\\.json|\\.ya?ml)?|\\.editorconfig|\\.nvmrc|\\.node-version|renovate\\.json",
    ),
    maxChars: 1_200,
    limit: 4,
  },

  // Where and how it deploys.
  {
    re: nested(
      "vercel\\.json|netlify\\.toml|fly\\.toml|render\\.ya?ml|railway\\.json|app\\.ya?ml|Procfile|wrangler\\.toml",
    ),
    maxChars: 1_200,
    limit: 2,
  },

  // PR conventions live here when there's no CONTRIBUTING.md.
  {
    re: /^\.github\/(PULL_REQUEST_TEMPLATE|CONTRIBUTING|CODEOWNERS)(\.md)?$/i,
    maxChars: 1_500,
    limit: 2,
  },

  // Data models, whichever ORM: Prisma, Rails, Django, raw SQL, Knex, Alembic.
  {
    re: /(^|\/)(schema\.(prisma|rb|sql)|structure\.sql|models\.py|knexfile\.(ts|js)|ormconfig\.(json|ts|js)|alembic\.ini)$/i,
    maxChars: 2_500,
    limit: 3,
  },

  // Build and run entry points that aren't config-shaped.
  {
    re: nested(
      "Makefile|justfile|Taskfile\\.ya?ml|Dockerfile|docker-compose\\.ya?ml|compose\\.ya?ml",
    ),
    maxChars: 2_000,
    limit: 3,
  },
];

const LOCKFILES: Record<string, string> = {
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

const MAX_TREE_ENTRIES = 300;
const MAX_DEPTH = 3;
const MAX_TOTAL_CHARS = 40_000;

export interface ContextFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface ProjectContext {
  root: string;
  packageManager?: string;
  /**
   * Directory the primary manifest was found in, relative to root, when it
   * isn't the root itself. Commands have to be run from here, and a model with
   * no way to know that will confidently write `npm run dev` for a project
   * where the only correct answer is `cd client && npm run dev`.
   */
  appRoot?: string;
  /** POSIX-style relative paths; directories carry a trailing slash. */
  tree: string[];
  treeTruncated: boolean;
  files: ContextFile[];
  approxTokens: number;
}

/**
 * Never read a file that might hold a credential.
 *
 * A tool built around careful handling of AI context has no business posting a
 * `.env` to a third-party API. `tison validate` treats a committed secret as an
 * error; this is that same rule, one step earlier.
 */
export function isSensitive(name: string): boolean {
  // `.env.example` and friends are committed on purpose: no values, but they
  // name the variables a project uses. Same carve-out `.gitignore` needs.
  if (/^\.env\.(example|sample|template|dist)$/i.test(name)) return false;

  return (
    /^\.env($|\.)/i.test(name) ||
    /\.(pem|key|p12|pfx|jks|keystore)$/i.test(name) ||
    /^(id_rsa|id_ed25519|credentials|\.npmrc|\.netrc|\.pypirc|secrets\.ya?ml)$/i.test(
      name,
    )
  );
}

const posix = (p: string): string => p.split(sep).join("/");

/**
 * Walk breadth-first.
 *
 * Depth-first with a global cap loses root-level files whose names sort late —
 * on a repo with enough top-level directories, `README.md` is never reached.
 * Level order guarantees every root file is seen before anything descends.
 */
function walk(root: string): { tree: string[]; truncated: boolean } {
  const tree: string[] = [];
  let queue: { dir: string; depth: number }[] = [{ dir: root, depth: 1 }];

  while (queue.length > 0 && tree.length < MAX_TREE_ENTRIES) {
    const next: { dir: string; depth: number }[] = [];

    for (const { dir, depth } of queue) {
      if (tree.length >= MAX_TREE_ENTRIES) break;

      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue; // an unreadable directory shouldn't fail the whole run
      }

      for (const entry of entries.sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        if (tree.length >= MAX_TREE_ENTRIES) break;
        if (IGNORED_DIRS.has(entry.name) || isSensitive(entry.name)) continue;

        const full = join(dir, entry.name);
        const rel = posix(relative(root, full));

        if (entry.isDirectory()) {
          tree.push(`${rel}/`);
          if (depth < MAX_DEPTH) next.push({ dir: full, depth: depth + 1 });
        } else if (entry.isFile()) {
          tree.push(rel);
        }
      }
    }

    queue = next;
  }

  return { tree, truncated: tree.length >= MAX_TREE_ENTRIES };
}

function readBounded(
  root: string,
  rel: string,
  maxChars: number,
): ContextFile | undefined {
  const full = join(root, rel);
  try {
    if (!statSync(full).isFile()) return undefined;
    const raw = readFileSync(full, "utf8");
    const truncated = raw.length > maxChars;
    return {
      path: rel,
      content: truncated ? raw.slice(0, maxChars) : raw,
      truncated,
    };
  } catch {
    return undefined;
  }
}

export function collectProjectContext(root: string): ProjectContext {
  const { tree, truncated: treeTruncated } = walk(root);

  // Candidates come from the tree we already walked, so discovery costs no
  // extra IO and can never reach somewhere the walk refused to go.
  const candidates = tree.filter((p) => !p.endsWith("/"));

  // The lockfile sits next to the manifest, which may not be at the root.
  // Checking only the root reports "package manager: undefined" for every
  // repo whose app lives one level down.
  let packageManager: string | undefined;
  for (const rel of candidates) {
    const name = rel.includes("/") ? rel.slice(rel.lastIndexOf("/") + 1) : rel;
    const depth = rel.split("/").length;
    if (depth > 2) continue;
    const manager = LOCKFILES[name];
    if (manager) {
      packageManager = manager;
      break;
    }
  }
  const files: ContextFile[] = [];
  const seen = new Set<string>();
  let budget = MAX_TOTAL_CHARS;

  for (const source of SOURCES) {
    if (budget <= 0) break;
    let taken = 0;

    for (const rel of candidates) {
      if (taken >= source.limit || budget <= 0) break;
      if (seen.has(rel) || !source.re.test(rel)) continue;

      const file = readBounded(root, rel, Math.min(source.maxChars, budget));
      if (!file) continue;

      seen.add(rel);
      budget -= file.content.length;
      files.push(file);
      taken++;
    }
  }

  // Where the primary manifest actually lives.
  const primary = files.find((f) =>
    /(^|\/)(package\.json|pyproject\.toml|go\.mod|Cargo\.toml|composer\.json|Gemfile|pom\.xml)$/i.test(
      f.path,
    ),
  );
  const appRoot = primary?.path.includes("/")
    ? primary.path.slice(0, primary.path.lastIndexOf("/"))
    : undefined;

  const ctx: ProjectContext = {
    root,
    packageManager,
    appRoot,
    tree,
    treeTruncated,
    files,
    approxTokens: 0,
  };

  ctx.approxTokens = Math.ceil(renderProjectContext(ctx).length / 4);
  return ctx;
}

/** Render the context as the stable prefix of a prompt. */
export function renderProjectContext(ctx: ProjectContext): string {
  const parts: string[] = ["<project>"];

  if (ctx.packageManager) {
    parts.push(
      `<package-manager>${ctx.packageManager} (from the lockfile)</package-manager>`,
    );
  }

  if (ctx.appRoot) {
    parts.push(
      `<app-root>${ctx.appRoot}/ — the manifest lives here, not at the repository root. ` +
        `Commands must be run from this directory, so prefix them accordingly ` +
        `(e.g. "cd ${ctx.appRoot} && npm run dev").</app-root>`,
    );
  }

  parts.push("<tree>", ctx.tree.join("\n"));
  if (ctx.treeTruncated) parts.push("… (tree truncated)");
  parts.push("</tree>");

  for (const file of ctx.files) {
    parts.push(`<file path="${file.path}">`, file.content.trimEnd());
    if (file.truncated) parts.push("… (truncated)");
    parts.push("</file>");
  }

  parts.push("</project>");
  return parts.join("\n");
}

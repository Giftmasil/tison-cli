import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { existsSync, statSync, readdirSync } from "node:fs";

/**
 * Absolute path to the bundled `templates/` directory.
 *
 * Resolved from THIS file's location (import.meta.dirname), never from
 * process.cwd(). After a global install the templates live next to the
 * compiled code inside node_modules, cwd is the user's project, which is
 * a completely different place. Getting this wrong is the classic
 * "works locally, ships empty" CLI bug.
 *
 * Compiled file lives at dist/core/paths.js, so templates/ is two levels up.
 */
export const TEMPLATES_ROOT = resolve(
  import.meta.dirname,
  "..",
  "..",
  "templates",
);

/** Only allow simple, single-segment names. Blocks path traversal at the source. */
const SAFE_NAME = /^[a-zA-Z0-9_-]+$/;

export function isSafeName(name: string): boolean {
  return SAFE_NAME.test(name);
}

/** List available category folders under templates/. */
export function listCategories(): string[] {
  if (!existsSync(TEMPLATES_ROOT)) return [];
  return readdirSync(TEMPLATES_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function categoryDir(category: string): string {
  if (!isSafeName(category)) {
    throw new Error(`Invalid category name: "${category}"`);
  }
  const dir = join(TEMPLATES_ROOT, category);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Unknown category: "${category}"`);
  }
  return dir;
}

/**
 * Resolve a relative target path against the output dir and PROVE it stays
 * inside. path.join/normalize are NOT security boundaries on their own, we
 * verify containment explicitly with path.relative.
 */
export function safeJoin(outDir: string, relPath: string): string {
  const base = resolve(outDir);
  const target = resolve(base, relPath);
  const rel = relative(base, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Refusing to write outside target directory: "${relPath}"`);
  }
  return target;
}

export { sep };

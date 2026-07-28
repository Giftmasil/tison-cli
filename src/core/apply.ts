import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { categoryDir, safeJoin } from "./paths.js";

/** One file declared by a category's template.json manifest. */
export interface TemplateFile {
  /** Path of the source file inside the category folder, e.g. "CLAUDE.md". */
  src: string;
  /** Where it lands in the user's project. Defaults to `src` if omitted. */
  dest?: string;
  /** Short label used in `tison generate <doc>` and `tison list`. */
  doc: string;
}

export interface TemplateManifest {
  category: string;
  description?: string;
  files: TemplateFile[];
}

export type ApplyStatus = "created" | "skipped" | "overwritten";

export interface AppliedFile {
  dest: string;
  status: ApplyStatus;
}

export interface ApplyOptions {
  category: string;
  /** If set, only apply files whose `doc` is in this list (for `generate`). */
  docs?: string[];
  outDir: string;
  force: boolean;
  dryRun: boolean;
}

export function readManifest(category: string): TemplateManifest {
  const dir = categoryDir(category);
  const manifestPath = join(dir, "template.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Category "${category}" has no template.json manifest.`);
  }
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as TemplateManifest;
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`Category "${category}" manifest declares no files.`);
  }
  return manifest;
}

/**
 * Core primitive. `run` applies a whole category; `generate` will pass `docs`
 * to apply a single file. Both share this one code path so behaviour can never
 * drift between the two commands.
 */
export function applyDocs(opts: ApplyOptions): AppliedFile[] {
  const dir = categoryDir(opts.category);
  const manifest = readManifest(opts.category);

  let files = manifest.files;
  if (opts.docs && opts.docs.length > 0) {
    const wanted = new Set(opts.docs);
    files = files.filter((f) => wanted.has(f.doc));
    const found = new Set(files.map((f) => f.doc));
    const missing = opts.docs.filter((d) => !found.has(d));
    if (missing.length > 0) {
      throw new Error(
        `No such doc(s) in category "${opts.category}": ${missing.join(", ")}`,
      );
    }
  }

  const results: AppliedFile[] = [];

  for (const file of files) {
    const rel = file.dest ?? file.src;
    const target = safeJoin(opts.outDir, rel); // throws if it escapes outDir
    const content = readFileSync(join(dir, file.src), "utf8");
    const exists = existsSync(target);

    if (exists && !opts.force) {
      results.push({ dest: rel, status: "skipped" });
      continue;
    }

    const status: ApplyStatus = exists ? "overwritten" : "created";

    if (!opts.dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }

    results.push({ dest: rel, status });
  }

  return results;
}

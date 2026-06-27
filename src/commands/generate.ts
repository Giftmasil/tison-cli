import { applyDocs } from "../core/apply.js";
import { report } from "../core/report.js";

export interface GenerateFlags {
  category: string;
  output: string;
  force: boolean;
  dryRun: boolean;
}

/**
 * Apply a SINGLE doc from a category. Shares the exact same core path as
 * `run` by passing a one-item `docs` filter to applyDocs, so the two commands
 * can never behave differently (no-clobber, dry-run, path safety, etc.).
 */
export function generateCommand(doc: string, flags: GenerateFlags): void {
  const results = applyDocs({
    category: flags.category,
    docs: [doc],
    outDir: flags.output,
    force: flags.force,
    dryRun: flags.dryRun,
  });
  console.log(`\ntison generate ${doc}  (from ${flags.category})  ->  ${flags.output}\n`);
  report(results, flags.dryRun);
}

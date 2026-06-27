import { applyDocs } from "../core/apply.js";
import { report } from "../core/report.js";

export interface RunFlags {
  output: string;
  force: boolean;
  dryRun: boolean;
}

export function runCommand(category: string, flags: RunFlags): void {
  const results = applyDocs({
    category,
    outDir: flags.output,
    force: flags.force,
    dryRun: flags.dryRun,
  });
  console.log(`\ntison run ${category}  ->  ${flags.output}\n`);
  report(results, flags.dryRun);
}

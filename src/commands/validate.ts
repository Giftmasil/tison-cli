import { validateDir, type Finding } from "../core/validate.js";

export interface ValidateFlags {
  dir: string;
  strict: boolean;
}

/** Returns a process exit code: 0 = ok, 1 = problems (errors, or warnings under --strict). */
export function validateCommand(flags: ValidateFlags): number {
  const { findings, filesScanned } = validateDir(flags.dir);

  console.log(`\ntison validate  ->  ${flags.dir}\n`);

  if (filesScanned === 0) {
    console.log("No AI-context files found (looked for AGENTS.md, CLAUDE.md, docs/, .claude/).");
    return 0;
  }

  if (findings.length === 0) {
    console.log(`Scanned ${filesScanned} file(s). No issues.`);
    return 0;
  }

  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }

  for (const [file, items] of byFile) {
    console.log(file);
    for (const f of items) {
      const loc = (f.line ? `L${f.line}` : "--").padEnd(5);
      const sev = f.severity.padEnd(7);
      console.log(`  ${sev} ${loc} ${f.message}`);
    }
    console.log("");
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  console.log(`Scanned ${filesScanned} file(s): ${errors} error(s), ${warnings} warning(s).`);

  const failed = errors > 0 || (flags.strict && warnings > 0);
  if (failed && errors === 0) console.log("(failing because --strict treats warnings as errors)");
  return failed ? 1 : 0;
}

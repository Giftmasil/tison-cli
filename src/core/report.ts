import type { AppliedFile } from "./apply.js";

const MARK: Record<AppliedFile["status"], string> = {
  created: "+",
  overwritten: "~",
  skipped: "·",
};

/** Print a summary of what was (or would be) written. */
export function report(results: AppliedFile[], dryRun: boolean): void {
  if (results.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const r of results) {
    console.log(
      `  ${MARK[r.status]} ${r.dest}${r.status === "skipped" ? "  (exists, use --force)" : ""}`,
    );
  }

  const created = results.filter((r) => r.status === "created").length;
  const overwritten = results.filter((r) => r.status === "overwritten").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  const parts: string[] = [];
  if (created) parts.push(`${created} created`);
  if (overwritten) parts.push(`${overwritten} overwritten`);
  if (skipped) parts.push(`${skipped} skipped`);

  console.log(`\n${dryRun ? "[dry run] " : ""}${parts.join(", ")}.`);
}

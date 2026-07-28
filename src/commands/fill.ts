import { readAiEnv } from "../core/env.js";
import { OpenRouterClient, formatUsd } from "../core/openrouter.js";
import { collectProjectContext } from "../core/context.js";
import {
  fillProject,
  findPendingFiles,
  type SlotOutcome,
} from "../core/fill.js";
import {
  detectProjects,
  isMisplaced,
  describeProject,
} from "../core/detect.js";
import { readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export interface FillFlags {
  dir: string;
  only?: string[];
  dryRun: boolean;
  model?: string;
  maxTokens?: number;
  /** Show every slot and exactly what came back for it. */
  verbose: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  filled: "filled    ",
  abstained: "abstained ",
  rejected: "REJECTED  ",
};

/** One line per slot: what was asked, and what came back. */
function printSlots(result: { path: string; slots: SlotOutcome[] }): void {
  if (result.slots.length === 0) return;
  console.log("");
  for (const slot of result.slots) {
    if (slot.reason === "reserved for a human") {
      const short =
        slot.hint.length > 52 ? `${slot.hint.slice(0, 51)}…` : slot.hint;
      console.log(
        `      ${slot.id.padEnd(4)} L${String(slot.line).padEnd(4)} yours     ${short}`,
      );
      continue;
    }
    const hint =
      slot.hint.length > 58 ? `${slot.hint.slice(0, 57)}…` : slot.hint;
    console.log(
      `      ${slot.id.padEnd(4)} L${String(slot.line).padEnd(4)} ${STATUS_LABEL[slot.status]}${hint}`,
    );

    if (slot.status === "filled") {
      const provenance = slot.grounded
        ? ""
        : "   (inferred — not stated in your files)";
      console.log(`             -> ${JSON.stringify(slot.raw)}${provenance}`);
      if (slot.evidence)
        console.log(
          `             ev ${JSON.stringify(slot.evidence.slice(0, 66))}`,
        );
    } else if (slot.raw === undefined) {
      // The schema marks every slot required, so an absent key means the model
      // ignored strict mode — a different problem from declining to answer.
      console.log("             -> key missing from the reply entirely");
    } else if (slot.raw.trim() === "") {
      console.log('             -> "" (declined)');
    } else {
      console.log(`             -> ${JSON.stringify(slot.raw)}`);
      console.log(`             ✗  ${slot.reason ?? "rejected"}`);
      if (slot.evidence)
        console.log(
          `             ev ${JSON.stringify(slot.evidence.slice(0, 66))}`,
        );
    }
  }
  console.log("");
}

const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  "venv",
  ".venv",
  "target",
  "vendor",
]);

/** Subdirectories that hold unfilled context files, one level down. */
function findMarkersNearby(
  dir: string,
): { dir: string; markers: number; files: number }[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: { dir: string; markers: number; files: number }[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      SKIP.has(entry.name)
    )
      continue;
    try {
      const pending = findPendingFiles(join(dir, entry.name));
      const markers = pending.reduce((n, f) => n + f.markers.length, 0);
      if (markers > 0)
        found.push({ dir: entry.name, markers, files: pending.length });
    } catch {
      /* unreadable subdirectory is not worth failing over */
    }
  }

  return found;
}

export async function fillCommand(flags: FillFlags): Promise<number> {
  console.log(`\ntison fill  ->  ${flags.dir}\n`);

  const pending = findPendingFiles(flags.dir, flags.only);

  if (pending.length === 0) {
    console.log("Nothing to fill here — no [TODO(tison)] markers found.");
    console.log("(Looked in AGENTS.md, CLAUDE.md, docs/, and .claude/.)");

    // `tison run` may well have scaffolded a directory down. Saying "nothing
    // found" while the markers sit one level away is the kind of silent dead
    // end this tool should never hand anyone.
    const elsewhere = findMarkersNearby(flags.dir);
    if (elsewhere.length > 0) {
      console.log("\nBut there are markers under:\n");
      for (const { dir, markers, files } of elsewhere) {
        console.log(
          `    ${dir}/   ${markers} marker(s) across ${files} file(s)`,
        );
      }
      console.log(`\nTry \`tison fill ${elsewhere[0]!.dir}\` instead.`);
    }

    return 0;
  }

  const totalMarkers = pending.reduce((n, f) => n + f.markers.length, 0);
  const totalAskable = pending.reduce(
    (n, f) => n + f.markers.filter((m) => !m.humanOnly).length,
    0,
  );

  for (const file of pending) {
    const human = file.markers.filter((m) => m.humanOnly).length;
    const askable = file.markers.length - human;
    const suffix = human > 0 ? `  (${askable} askable, ${human} yours)` : "";
    console.log(
      `  ${String(file.markers.length).padStart(3)} ${file.path.padEnd(44)}${suffix}`,
    );
    for (const line of file.malformed) {
      console.log(
        `      warning: unterminated marker at line ${line} — skipped`,
      );
    }
    if (file.oversized) {
      console.log(
        `      warning: ${file.source.length} chars — too large to send, will be skipped`,
      );
    }
  }
  const reserved = totalMarkers - totalAskable;
  console.log(
    `\n  ${totalMarkers} marker(s) across ${pending.length} file(s)` +
      (reserved > 0
        ? ` — ${totalAskable} to ask about, ${reserved} reserved for you.`
        : "."),
  );

  // Show exactly what will be sent. A bare count is opaque: "1 manifest" and
  // "7 manifests" look equally fine until you notice the run answered nothing.
  const context = collectProjectContext(flags.dir);

  console.log(
    `\n  Reading from your project (~${context.approxTokens} tokens):\n`,
  );
  if (context.packageManager)
    console.log(`    package manager: ${context.packageManager}`);
  if (context.appRoot) console.log(`    app lives in:    ${context.appRoot}/`);
  for (const file of context.files) {
    console.log(`    - ${file.path}${file.truncated ? "  (truncated)" : ""}`);
  }

  if (context.files.length === 0) {
    const projects = detectProjects(flags.dir);
    console.log("    (nothing — no manifests found)\n");
    console.log(
      "  Without a manifest there's almost nothing to answer from, and most",
    );
    console.log("  markers will come back unfilled.\n");

    if (isMisplaced(projects)) {
      console.log("  Your project looks like it's actually in:\n");
      for (const project of projects.filter((p) => p.dir !== "")) {
        console.log(`    ${describeProject(project)}`);
      }
      console.log(
        "\n  Try `tison fill " +
          projects.find((p) => p.dir !== "")!.dir +
          "` instead.",
      );
    } else {
      console.log("  Check you're pointing at the right directory.");
    }
    return 1;
  }

  if (flags.dryRun) {
    console.log("\n[dry run] No call made, nothing written.");
    return 0;
  }

  let env;
  try {
    env = readAiEnv({ model: flags.model, dir: flags.dir });
  } catch (err) {
    console.log(`\n${(err as Error).message}`);
    return 1;
  }

  console.log(`  Model: ${env.model}\n`);

  // One session id per run pins every call to the same provider, so the shared
  // prompt prefix actually hits the cache instead of being re-billed each time.
  const client = new OpenRouterClient(env, {
    sessionId: `tison-fill-${randomUUID()}`,
  });

  const results = await fillProject({
    dir: flags.dir,
    client,
    context,
    only: flags.only,
    dryRun: false,
    maxTokens: flags.maxTokens,
    // Each file takes seconds, so report it the moment it lands rather than
    // printing five filenames and then five results once everything is done.
    onFileStart: (path) => process.stdout.write(`  ${path.padEnd(46)} `),
    onFileDone: (r) => {
      if (r.error) {
        console.log(`failed\n      ${r.error}`);
        return;
      }
      const human = r.markers - r.askable;
      const inferred = r.slots.filter(
        (s) => s.status === "filled" && !s.grounded,
      ).length;
      const bits = [`${r.applied.length}/${r.askable} filled`];
      if (inferred > 0) bits.push(`${inferred} inferred`);
      if (human > 0) bits.push(`${human} for a human`);
      if (r.cachedTokens > 0) bits.push(`${r.cachedTokens} cached`);
      console.log(
        `${bits.join(", ")}${r.written || r.askable === 0 ? "" : " (nothing written)"}`,
      );

      if (flags.verbose) {
        printSlots(r);
      } else {
        for (const item of r.rejected) {
          console.log(`      rejected ${item.id}: ${item.reason}`);
        }
      }
    },
  });

  let cost = 0;
  let applied = 0;
  let abstained = 0;
  let rejected = 0;
  let human = 0;
  let failures = 0;

  for (const r of results) {
    if (r.error) {
      failures++;
      continue;
    }
    cost += r.costUsd ?? 0;
    applied += r.applied.length;
    rejected += r.rejected.length;
    human += r.markers - r.askable;
    // A rejected slot is also unfilled, so it lands in `abstained` too. Counting
    // it in both places made the totals exceed the number of markers.
    abstained +=
      r.abstained.length - (r.markers - r.askable) - r.rejected.length;
  }

  const parts = [`${applied} filled`];
  if (abstained > 0) parts.push(`${abstained} the repo couldn't answer`);
  if (human > 0) parts.push(`${human} reserved for you`);
  if (rejected > 0) parts.push(`${rejected} rejected`);
  console.log(`\n${parts.join(", ")}.`);
  console.log(`Cost: ${formatUsd(cost)}`);

  const inferredTotal = results.reduce(
    (n, r) =>
      n + r.slots.filter((s) => s.status === "filled" && !s.grounded).length,
    0,
  );
  if (inferredTotal > 0) {
    console.log(
      `\n${inferredTotal} value(s) marked "inferred" don't appear in your files — the model\nsupplied a convention rather than reading one. Check those first.`,
    );
  }

  if (abstained > 0 || rejected > 0) {
    console.log(
      "\nRemaining markers are the ones the repo couldn't answer — they need a human.\nRun `tison validate` to list them.",
    );
    if (!flags.verbose) {
      console.log(
        "Run again with --verbose to see what the model returned for each one.",
      );
    }
  }

  return failures > 0 ? 1 : 0;
}

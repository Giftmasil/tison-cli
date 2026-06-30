import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "error" | "warning";

export interface Finding {
  file: string; // relative to the scanned dir
  line?: number;
  severity: Severity;
  rule: string;
  message: string;
}

export interface ValidationResult {
  findings: Finding[];
  filesScanned: number;
}

/** Context files past this length get a bloat warning (per AGENTbench-era guidance). */
const MAX_LINES = 150;

/**
 * Conservative secret heuristics. We only ever report the RULE name and line
 * number - never the matched text - so running validate can't leak the secret
 * into logs/CI output.
 */
const SECRET_RULES: { rule: string; re: RegExp }[] = [
  { rule: "private-key", re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { rule: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: "openai-style-key", re: /\bsk-(?:or-)?[A-Za-z0-9_-]{16,}\b/ },
  { rule: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  {
    rule: "assigned-secret",
    re: /(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-/+]{16,}["']/i,
  },
];

function walkMarkdown(dir: string, acc: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, acc);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) acc.push(full);
  }
}

/** The AI-context surface tison cares about: root files + docs/ + .claude/. */
export function collectContextFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const p = join(dir, name);
    if (existsSync(p) && statSync(p).isFile()) files.push(p);
  }
  walkMarkdown(join(dir, "docs"), files);
  walkMarkdown(join(dir, ".claude"), files);
  return [...new Set(files)];
}

export function validateDir(dir: string): ValidationResult {
  const files = collectContextFiles(dir);
  const findings: Finding[] = [];

  for (const file of files) {
    const rel = relative(dir, file) || file;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);

    if (lines.length > MAX_LINES) {
      findings.push({
        file: rel,
        severity: "warning",
        rule: "too-long",
        message: `${lines.length} lines — keep context files under ${MAX_LINES}; shorter ones get followed more`,
      });
    }

    lines.forEach((text, i) => {
      const line = i + 1;

      if (text.includes("[TODO(tison):")) {
        findings.push({
          file: rel,
          line,
          severity: "warning",
          rule: "unfilled-todo",
          message: "unfilled [TODO(tison)] placeholder",
        });
      }

      for (const { rule, re } of SECRET_RULES) {
        if (re.test(text)) {
          findings.push({
            file: rel,
            line,
            severity: "error",
            rule: "possible-secret",
            message: `looks like a committed secret (${rule}) — never commit credentials`,
          });
          break; // one secret finding per line is enough
        }
      }
    });
  }

  return { findings, filesScanned: files.length };
}

/**
 * Finding and filling `[TODO(tison): ...]` markers.
 *
 * This module is deliberately pure and offline. Every decision about *what a
 * document ends up saying* is made here, from offsets we computed ourselves —
 * the model only ever supplies short strings keyed by marker id. It never sees
 * a whole file it could rewrite, and its reply can't move a single byte of the
 * curated prose around it.
 *
 * That constraint is the product, not an implementation detail. The research
 * this tool is built on found that LLM-generated context files *reduced* agent
 * success; hand-written ones helped. Filling slots keeps us on the right side
 * of that line.
 */

const OPEN = "[TODO(tison):";

/**
 * Opens either kind of marker.
 *
 * `[TODO(tison): ...]`       — a slot a model can answer from the repo.
 * `[TODO(tison:human): ...]` — a slot that needs judgment or several lines of
 *                              prose, so no model is ever asked. Import
 *                              boundaries, module ownership, a numbered
 *                              workflow, a code example: these are multi-line
 *                              by nature, and `applyFills` refuses multi-line
 *                              values. Sending them was spending money to be
 *                              told nothing.
 */
const MARKER_OPEN = /\[TODO\(tison(:human)?\):/g;

/** Anything longer than this is prose, not a slot value. */
const MAX_FILL_LENGTH = 400;

export interface Marker {
  /** Stable id within its file, assigned in document order: m1, m2, … */
  id: string;
  /** The text between the colon and the closing bracket, trimmed. */
  hint: string;
  /** Offset of the opening `[`. */
  start: number;
  /** Offset one past the closing `]`. */
  end: number;
  /** 1-based line number, for human-readable reporting. */
  line: number;
  /**
   * True when the marker sits inside a backtick span, e.g. `` `[TODO(tison): …]` ``.
   * The fill must then be a bare value — the backticks already exist in the
   * template, so a model that helpfully adds its own would produce ``` ``pnpm test`` ```.
   */
  inCode: boolean;
  /** The whole line the marker sits on, trimmed. Gives the model local context. */
  context: string;
  /** Marked `tison:human` — never sent to a model, always left for a person. */
  humanOnly: boolean;
}

export interface ParseResult {
  markers: Marker[];
  /** 1-based lines where a marker opened but never closed. */
  malformed: number[];
}

/** Precompute line-start offsets so line lookup is a binary search, not a scan. */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Find every marker in a document.
 *
 * Bracket depth is tracked rather than regex-matched, so a hint containing its
 * own brackets — `[TODO(tison): protected paths, e.g. /infra]` is fine today,
 * but someone will eventually write `[TODO(tison): the [x] case]` — doesn't
 * truncate at the wrong place.
 */
export function parseMarkers(source: string): ParseResult {
  const starts = lineStarts(source);
  const markers: Marker[] = [];
  const malformed: number[] = [];

  let n = 0;

  MARKER_OPEN.lastIndex = 0;
  for (;;) {
    const match = MARKER_OPEN.exec(source);
    if (match === null) break;

    const open = match.index;
    const humanOnly = match[1] !== undefined;
    const headerLength = match[0].length;

    let depth = 1;
    let i = open + headerLength;
    let close = -1;

    while (i < source.length) {
      const ch = source[i];
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
      i++;
    }

    if (close === -1) {
      malformed.push(lineOf(starts, open));
      MARKER_OPEN.lastIndex = open + headerLength;
      continue;
    }

    const line = lineOf(starts, open);
    const lineStart = starts[line - 1]!;
    const nextNewline = source.indexOf("\n", open);
    const lineEnd = nextNewline === -1 ? source.length : nextNewline;

    // An odd number of backticks before the marker means we're inside a span.
    const before = source.slice(lineStart, open);
    const inCode = (before.match(/`/g)?.length ?? 0) % 2 === 1;

    markers.push({
      id: `m${++n}`,
      hint: source.slice(open + headerLength, close).trim(),
      start: open,
      end: close + 1,
      line,
      inCode,
      context: source.slice(lineStart, lineEnd).trim(),
      humanOnly,
    });

    MARKER_OPEN.lastIndex = close + 1;
  }

  return { markers, malformed };
}

export interface RejectedFill {
  id: string;
  reason: string;
}

export interface ApplyFillsResult {
  text: string;
  /** Ids whose value was written into the document. */
  applied: string[];
  /** Ids the model declined to answer — the marker is left in place. */
  abstained: string[];
  /** Ids whose value we refused, with why. The marker is left in place. */
  rejected: RejectedFill[];
}

/**
 * Clean up a value the model returned, or explain why it's unusable.
 * Returns null when the model legitimately abstained.
 */
function normalise(
  raw: string,
  marker: Marker,
): { value: string } | { reject: string } | null {
  let value = raw.trim();

  // Empty is the agreed signal for "I can't tell from the repo" — leaving the
  // marker in place is strictly better than inventing a command that doesn't exist.
  if (value === "") return null;

  if (value.includes(OPEN) || value.includes("[TODO(tison:human):")) {
    return { reject: "echoed the marker back instead of filling it" };
  }

  if (/\r?\n/.test(value)) {
    return { reject: "value spans multiple lines; markers are inline slots" };
  }

  if (value.length > MAX_FILL_LENGTH) {
    return {
      reject: `value is ${value.length} chars; slots hold values, not prose`,
    };
  }

  // The template already supplies the backticks around a code-span marker.
  if (marker.inCode) {
    value = value.replace(/^`+/, "").replace(/`+$/, "").trim();
    if (value === "") return { reject: "value was nothing but backticks" };
    if (value.includes("`")) {
      return { reject: "value contains a backtick inside a code span" };
    }
  }

  return { value };
}

/**
 * Substitute values into a document.
 *
 * Applied back-to-front so that every marker's offsets stay valid while earlier
 * ones are still being replaced. The source string is spliced directly and
 * never split on newlines, which is what keeps CRLF files byte-identical
 * outside the slots we touched.
 */
export function applyFills(
  source: string,
  markers: Marker[],
  fills: Record<string, string>,
): ApplyFillsResult {
  const applied: string[] = [];
  const abstained: string[] = [];
  const rejected: RejectedFill[] = [];

  let text = source;

  for (const marker of [...markers].sort((a, b) => b.start - a.start)) {
    // A human-only marker is never filled, no matter what arrives for it.
    if (marker.humanOnly) {
      abstained.push(marker.id);
      continue;
    }

    const raw = fills[marker.id];

    if (raw === undefined) {
      abstained.push(marker.id);
      continue;
    }

    const outcome = normalise(raw, marker);

    if (outcome === null) {
      abstained.push(marker.id);
      continue;
    }
    if ("reject" in outcome) {
      rejected.push({ id: marker.id, reason: outcome.reject });
      continue;
    }

    text = text.slice(0, marker.start) + outcome.value + text.slice(marker.end);
    applied.push(marker.id);
  }

  // Sorting restores document order, since we filled in reverse.
  applied.reverse();
  abstained.reverse();
  rejected.reverse();

  return { text, applied, abstained, rejected };
}

/**
 * Blank out the body of every human-only marker before a document is sent.
 *
 * The document goes to the model as context, so without this a
 * `[TODO(tison:human): ...]` hint travels too — and those hold exactly the
 * content someone chose not to hand to a model. Structure is preserved so the
 * document still reads correctly; only the reserved text goes.
 */
export function redactHumanMarkers(source: string, markers: Marker[]): string {
  let text = source;
  for (const marker of [...markers].sort((a, b) => b.start - a.start)) {
    if (!marker.humanOnly) continue;
    text = `${text.slice(0, marker.start)}[TODO(tison:human): reserved]${text.slice(marker.end)}`;
  }
  return text;
}

/** Render markers for a prompt: one line each, id first so the model can key its reply. */
export function describeMarkers(markers: Marker[]): string {
  return markers
    .map((m) => {
      const kind = m.inCode ? " [code span - bare value, no backticks]" : "";
      return `${m.id} (line ${m.line})${kind}\n  hint: ${m.hint}\n  line: ${m.context}`;
    })
    .join("\n\n");
}

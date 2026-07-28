import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMarkers,
  applyFills,
  describeMarkers,
  redactHumanMarkers,
} from "./markers.js";

test("finds every marker in document order with stable ids", () => {
  const src = "a [TODO(tison): one] b [TODO(tison): two]";
  const { markers } = parseMarkers(src);
  assert.deepEqual(
    markers.map((m) => [m.id, m.hint]),
    [
      ["m1", "one"],
      ["m2", "two"],
    ],
  );
});

test("distinguishes identical hints by position, not by text", () => {
  // `e.g. pnpm test` appears in both AGENTS.md and testing.md, and twice in
  // testing.md. Keying fills by hint text would collapse them.
  const src =
    "- All: `[TODO(tison): e.g. pnpm test]`\n- Unit: `[TODO(tison): e.g. pnpm test]`";
  const { markers } = parseMarkers(src);
  assert.equal(markers.length, 2);
  assert.equal(markers[0]!.hint, markers[1]!.hint);
  assert.notEqual(markers[0]!.id, markers[1]!.id);

  const out = applyFills(src, markers, {
    m1: "npm test",
    m2: "npm test -- --unit",
  });
  assert.equal(out.text, "- All: `npm test`\n- Unit: `npm test -- --unit`");
});

test("tracks bracket depth so nested brackets don't truncate the hint", () => {
  const { markers } = parseMarkers("[TODO(tison): handle the [x] case]");
  assert.equal(markers.length, 1);
  assert.equal(markers[0]!.hint, "handle the [x] case");
});

test("reports an unterminated marker instead of swallowing the rest of the file", () => {
  const { markers, malformed } = parseMarkers(
    "ok\n[TODO(tison): never closed\nmore text",
  );
  assert.deepEqual(markers, []);
  assert.deepEqual(malformed, [2]);
});

test("detects markers inside a backtick span", () => {
  const { markers } = parseMarkers(
    "- Test: `[TODO(tison): e.g. pnpm test]`\n- Note: [TODO(tison): plain]",
  );
  assert.equal(markers[0]!.inCode, true);
  assert.equal(markers[1]!.inCode, false);
});

test("reports correct line numbers and the surrounding line", () => {
  const { markers } = parseMarkers(
    "# Title\n\nDate: [TODO(tison): YYYY-MM-DD]\n",
  );
  assert.equal(markers[0]!.line, 3);
  assert.equal(markers[0]!.context, "Date: [TODO(tison): YYYY-MM-DD]");
});

test("strips backticks the model adds inside an existing code span", () => {
  const src = "- Test: `[TODO(tison): e.g. pnpm test]`";
  const { markers } = parseMarkers(src);
  const out = applyFills(src, markers, { m1: "`npm test`" });
  assert.equal(out.text, "- Test: `npm test`");
});

test("leaves the marker in place when the model abstains", () => {
  const src = "Stack: [TODO(tison): languages]";
  const { markers } = parseMarkers(src);
  const out = applyFills(src, markers, { m1: "   " });
  assert.equal(out.text, src, "an unfilled marker beats an invented one");
  assert.deepEqual(out.abstained, ["m1"]);
  assert.deepEqual(out.applied, []);
});

test("leaves the marker in place when the model omits the key entirely", () => {
  const src = "Stack: [TODO(tison): languages]";
  const { markers } = parseMarkers(src);
  const out = applyFills(src, markers, {});
  assert.equal(out.text, src);
  assert.deepEqual(out.abstained, ["m1"]);
});

test("rejects a value that echoes the marker back", () => {
  const src = "Stack: [TODO(tison): languages]";
  const { markers } = parseMarkers(src);
  const out = applyFills(src, markers, { m1: "[TODO(tison): languages]" });
  assert.equal(out.text, src);
  assert.equal(out.rejected[0]?.id, "m1");
});

test("rejects a multi-line value that would break the document structure", () => {
  const src = "- Install: `[TODO(tison): cmd]`";
  const { markers } = parseMarkers(src);
  const out = applyFills(src, markers, { m1: "npm ci\nnpm run build" });
  assert.equal(out.text, src);
  assert.match(out.rejected[0]!.reason, /multiple lines/);
});

test("rejects prose dumped into a slot", () => {
  const src = "Stack: [TODO(tison): languages]";
  const { markers } = parseMarkers(src);
  const out = applyFills(src, markers, { m1: "x".repeat(401) });
  assert.equal(out.text, src);
  assert.match(out.rejected[0]!.reason, /prose/);
});

test("preserves CRLF and all surrounding bytes outside the slots", () => {
  const src = "# T\r\n\r\n- Dev: `[TODO(tison): cmd]`\r\n\r\nTrailing.\r\n";
  const { markers } = parseMarkers(src);
  const out = applyFills(src, markers, { m1: "npm run dev" });
  assert.equal(
    out.text,
    "# T\r\n\r\n- Dev: `npm run dev`\r\n\r\nTrailing.\r\n",
  );
});

test("fills many markers on one line without corrupting offsets", () => {
  const src = "[TODO(tison): a] and [TODO(tison): b] and [TODO(tison): c]";
  const { markers } = parseMarkers(src);
  const out = applyFills(src, markers, { m1: "AAAAAAAA", m2: "B", m3: "CCC" });
  assert.equal(out.text, "AAAAAAAA and B and CCC");
  assert.deepEqual(out.applied, ["m1", "m2", "m3"]);
});

test("a partially answered document keeps the unanswered markers intact", () => {
  const src =
    "- Dev: `[TODO(tison): dev cmd]`\n- Test: `[TODO(tison): test cmd]`";
  const { markers } = parseMarkers(src);
  const out = applyFills(src, markers, { m1: "npm run dev" });
  assert.equal(
    out.text,
    "- Dev: `npm run dev`\n- Test: `[TODO(tison): test cmd]`",
  );
  assert.deepEqual(out.applied, ["m1"]);
  assert.deepEqual(out.abstained, ["m2"]);
});

test("a document with no markers is returned byte-identical", () => {
  const src = "# CLAUDE.md\n\n@AGENTS.md\n";
  const { markers } = parseMarkers(src);
  assert.deepEqual(markers, []);
  assert.equal(applyFills(src, markers, {}).text, src);
});

test("describeMarkers flags code spans so the model omits backticks", () => {
  const { markers } = parseMarkers("- Test: `[TODO(tison): e.g. pnpm test]`");
  assert.match(describeMarkers(markers), /code span/);
});

test("distinguishes human-only markers from fillable ones", () => {
  const src =
    "- A: [TODO(tison): fillable]\n- B: [TODO(tison:human): needs judgment]\n";
  const { markers } = parseMarkers(src);
  assert.equal(markers.length, 2);
  assert.equal(markers[0]!.humanOnly, false);
  assert.equal(markers[1]!.humanOnly, true);
  assert.equal(markers[1]!.hint, "needs judgment");
});

test("never fills a human-only marker, whatever comes back for it", () => {
  const src = "- A: [TODO(tison): fillable]\n- B: [TODO(tison:human): yours]\n";
  const { markers } = parseMarkers(src);
  const out = applyFills(src, markers, {
    m1: "answered",
    m2: "the model tried anyway",
  });

  assert.deepEqual(out.applied, ["m1"]);
  assert.deepEqual(out.abstained, ["m2"]);
  assert.ok(
    out.text.includes("[TODO(tison:human): yours]"),
    "left intact for a person",
  );
});

test("ids stay stable across both marker kinds", () => {
  const { markers } = parseMarkers(
    "[TODO(tison:human): a]\n[TODO(tison): b]\n[TODO(tison:human): c]\n[TODO(tison): d]\n",
  );
  assert.deepEqual(
    markers.map((m) => m.id),
    ["m1", "m2", "m3", "m4"],
  );
  assert.deepEqual(
    markers.map((m) => m.humanOnly),
    [true, false, true, false],
  );
});

test("an unterminated human marker is reported, not swallowed", () => {
  const { markers, malformed } = parseMarkers(
    "[TODO(tison:human): never closed\nmore",
  );
  assert.deepEqual(markers, []);
  assert.deepEqual(malformed, [1]);
});

test("redacts human-only marker bodies before a document is sent", () => {
  const secret = "our incident commander is Ada; do not page anyone else";
  const src = `- A: \`[TODO(tison): dev cmd]\`\n- B: [TODO(tison:human): ${secret}]\n`;
  const { markers } = parseMarkers(src);

  const outbound = redactHumanMarkers(src, markers);
  assert.ok(!outbound.includes(secret), "reserved text must not travel");
  assert.ok(
    outbound.includes("[TODO(tison:human): reserved]"),
    "structure survives",
  );
  assert.ok(
    outbound.includes("[TODO(tison): dev cmd]"),
    "askable slots are untouched",
  );

  // Redaction must not disturb the offsets the real document is spliced at.
  assert.equal(parseMarkers(outbound).markers.length, 2);
});

test("redaction leaves a document with no human markers byte-identical", () => {
  const src = "- A: `[TODO(tison): dev cmd]`\n";
  const { markers } = parseMarkers(src);
  assert.equal(redactHumanMarkers(src, markers), src);
});

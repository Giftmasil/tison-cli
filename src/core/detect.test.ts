import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { detectProjects, isMisplaced, describeProject } from "./detect.js";
import { choose, confirm, isInteractive } from "./prompt.js";

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "tison-detect-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

test("spots a project at the repository root", () => {
  const found = detectProjects(
    project({ "package.json": "{}", "package-lock.json": "{}" }),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]!.dir, "");
  assert.equal(found[0]!.packageManager, "npm");
  assert.equal(isMisplaced(found), false);
});

test("spots a project one level down and flags the root as empty", () => {
  const found = detectProjects(
    project({
      "README.md": "# repo",
      "client/package.json": "{}",
      "client/pnpm-lock.yaml": "",
    }),
  );
  assert.equal(found.length, 1);
  assert.equal(found[0]!.dir, "client");
  assert.equal(found[0]!.packageManager, "pnpm");
  assert.equal(
    isMisplaced(found),
    true,
    "this is the case that needs a prompt",
  );
});

test("root wins when both exist, so a monorepo isn't second-guessed", () => {
  const found = detectProjects(
    project({ "package.json": "{}", "client/package.json": "{}" }),
  );
  assert.equal(found[0]!.dir, "");
  assert.equal(isMisplaced(found), false);
});

test("finds every sibling app so the user can pick", () => {
  const found = detectProjects(
    project({
      "README.md": "#",
      "client/package.json": "{}",
      "server/package.json": "{}",
    }),
  );
  assert.deepEqual(
    found.map((p) => p.dir),
    ["client", "server"],
  );
});

test("recognises projects that aren't JavaScript", () => {
  for (const [manifest, lockfile, manager] of [
    ["pyproject.toml", "poetry.lock", "poetry"],
    ["Cargo.toml", "Cargo.lock", "cargo"],
    ["Gemfile", "Gemfile.lock", "bundler"],
    ["go.mod", "", ""],
  ] as const) {
    const files: Record<string, string> = { [`api/${manifest}`]: "" };
    if (lockfile) files[`api/${lockfile}`] = "";
    const found = detectProjects(project(files));
    assert.equal(found[0]?.manifest, manifest);
    if (manager) assert.equal(found[0]?.packageManager, manager);
  }
});

test("ignores directories that are never the project", () => {
  const found = detectProjects(
    project({
      "README.md": "#",
      "node_modules/left-pad/package.json": "{}",
      "docs/package.json": "{}",
      ".next/package.json": "{}",
    }),
  );
  assert.deepEqual(found, []);
});

test("an empty directory yields nothing rather than throwing", () => {
  assert.deepEqual(detectProjects(project({})), []);
  assert.equal(
    isMisplaced([]),
    false,
    "nothing found is not the same as misplaced",
  );
});

test("describes a project in one readable line", () => {
  assert.equal(
    describeProject({
      dir: "client",
      manifest: "package.json",
      packageManager: "npm",
    }),
    "client/  (package.json, npm)",
  );
  assert.equal(
    describeProject({ dir: "", manifest: "go.mod" }),
    "here  (go.mod)",
  );
});

test("prompts never block without a TTY — CI must not hang", async () => {
  assert.equal(isInteractive(), false, "the test runner has no TTY");
  assert.equal(await confirm("proceed?", true), true, "returns the default");
  assert.equal(await confirm("proceed?", false), false);
  assert.equal(
    await choose("where?", [
      { label: "a", value: "a" },
      { label: "b", value: "b" },
    ]),
    "a",
  );
});

test("a single option needs no question", async () => {
  assert.equal(await choose("where?", [{ label: "only", value: 42 }]), 42);
});

test("a scaffolded subdirectory is discoverable from the parent", async () => {
  // `tison run` may put the files a level down. `tison fill` at the root then
  // finding "nothing" and stopping is a silent dead end.
  const { findPendingFiles } = await import("./fill.js");
  const dir = project({
    "README.md": "# repo",
    "client/package.json": "{}",
    "client/AGENTS.md": "- Dev: `[TODO(tison): dev cmd]`\n",
    "client/docs/testing.md": "- Test: `[TODO(tison): test cmd]`\n",
  });

  assert.deepEqual(findPendingFiles(dir), [], "nothing at the root");

  const nested = findPendingFiles(join(dir, "client"));
  assert.equal(nested.length, 2);
  assert.equal(
    nested.reduce((n, f) => n + f.markers.length, 0),
    2,
  );
});

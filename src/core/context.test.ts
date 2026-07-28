import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  collectProjectContext,
  renderProjectContext,
  isSensitive,
} from "./context.js";

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "tison-ctx-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const render = (dir: string): string =>
  renderProjectContext(collectProjectContext(dir));

test("reads the README — the only source that says what a project is", () => {
  const out = render(
    project({
      "package.json": "{}",
      "README.md": "# Soft\n\nA scheduling service for clinics.\n",
    }),
  );
  assert.match(out, /scheduling service for clinics/);
});

test("reads CONTRIBUTING, where branch and PR conventions actually live", () => {
  const out = render(
    project({
      "package.json": "{}",
      "CONTRIBUTING.md": "Branches: feat/TICKET-123/short-desc\n",
    }),
  );
  assert.match(out, /feat\/TICKET-123/);
});

test("reads CI workflows, which answer the 'what must pass before merge' marker", () => {
  const out = render(
    project({
      "package.json": "{}",
      ".github/workflows/ci.yml":
        "jobs:\n  test:\n    steps:\n      - run: pnpm lint && pnpm test\n",
    }),
  );
  assert.match(out, /pnpm lint && pnpm test/);
});

test("finds the data model whichever ORM the project uses", () => {
  const cases: Record<string, [string, string]> = {
    prisma: ["prisma/schema.prisma", "model User { id String @id }"],
    drizzle: ["drizzle.config.ts", "export default { schema: './src/db' }"],
    knex: ["knexfile.ts", "export default { client: 'pg' }"],
    typeorm: ["ormconfig.json", '{"type":"postgres"}'],
    rails: ["db/schema.rb", "ActiveRecord::Schema.define do end"],
    django: ["app/models.py", "class User(models.Model): pass"],
    alembic: ["alembic.ini", "[alembic]\nscript_location = migrations"],
    sql: ["db/schema.sql", "CREATE TABLE users (id uuid);"],
  };

  for (const [orm, [path, content]] of Object.entries(cases)) {
    const out = render(project({ "package.json": "{}", [path]: content }));
    assert.match(
      out,
      new RegExp(content.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${orm} not discovered`,
    );
  }
});

test("one pattern catches every root *.config.* without naming any tool", () => {
  const out = render(
    project({
      "package.json": "{}",
      "next.config.ts": "export default { reactStrictMode: true }",
      "vitest.config.ts": "export default { test: { environment: 'node' } }",
      "tailwind.config.js": "module.exports = { content: [] }",
    }),
  );
  assert.match(out, /reactStrictMode/);
  assert.match(out, /environment: 'node'/);
  assert.match(out, /module.exports/);
});

test("a root README survives a repo with many earlier-sorting directories", () => {
  // Depth-first with a global cap would spend the whole budget inside a/, b/, c/
  // and never reach R. Breadth-first sees every root entry first.
  const files: Record<string, string> = {
    "package.json": "{}",
    "README.md": "# Findable\n",
  };
  for (const d of "abcdefghijklmnop") {
    for (let i = 0; i < 30; i++) files[`${d}/file${i}.ts`] = "//";
  }
  const ctx = collectProjectContext(project(files));
  assert.ok(ctx.treeTruncated, "this repo should exceed the tree cap");
  assert.match(renderProjectContext(ctx), /# Findable/);
});

test("never reads a credential, whatever it is called", () => {
  for (const name of [
    ".env",
    ".env.production",
    "server.pem",
    "app.key",
    ".npmrc",
    "secrets.yaml",
  ]) {
    assert.ok(isSensitive(name), `${name} should be treated as sensitive`);
  }
  assert.ok(
    !isSensitive(".env.example"),
    "the committed template is safe to read",
  );

  const out = render(
    project({
      "package.json": "{}",
      ".env": "DATABASE_URL=postgres://admin:SUPERSECRET@prod/db",
      ".env.production": "STRIPE_KEY=sk_live_51H",
      "certs/server.pem": "-----BEGIN PRIVATE KEY-----",
    }),
  );
  assert.ok(!out.includes("SUPERSECRET"));
  assert.ok(!out.includes("sk_live_51H"));
  assert.ok(!out.includes("BEGIN PRIVATE KEY"));
  assert.ok(!/\.env/.test(out), "not even listed in the tree");
});

test("skips build output and dependency directories", () => {
  const out = render(
    project({
      "package.json": "{}",
      "node_modules/left-pad/index.js": "module.exports=1",
      ".next/cache/blob": "garbage",
      "dist/bundle.js": "compiled",
    }),
  );
  assert.ok(!out.includes("left-pad"));
  assert.ok(!out.includes("garbage"));
  assert.ok(!out.includes("compiled"));
});

test("stays inside the character budget on a large repo", () => {
  const files: Record<string, string> = { "package.json": "x".repeat(50_000) };
  for (let i = 0; i < 8; i++) files[`thing${i}.config.ts`] = "y".repeat(20_000);
  const ctx = collectProjectContext(project(files));
  const total = ctx.files.reduce((n, f) => n + f.content.length, 0);
  assert.ok(total <= 40_000, `budget exceeded: ${total}`);
  assert.ok(ctx.files[0]!.truncated);
});

test("detects the package manager from the lockfile", () => {
  for (const [lockfile, manager] of Object.entries({
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "package-lock.json": "npm",
    "Cargo.lock": "cargo",
  })) {
    const ctx = collectProjectContext(
      project({ "package.json": "{}", [lockfile]: "" }),
    );
    assert.equal(ctx.packageManager, manager);
  }
});

test("renders deterministically so the cache prefix stays stable", () => {
  const dir = project({
    "package.json": "{}",
    "README.md": "# X",
    "next.config.ts": "export default {}",
    ".github/workflows/ci.yml": "on: push",
  });
  assert.equal(render(dir), render(dir));
});

test("finds the app when it lives one directory down", () => {
  // client/, app/, web/, frontend/, server/ are all normal layouts. Anchoring
  // manifests to the root makes every one of them look like an empty project.
  const dir = project({
    "README.md": "# Monorepo-ish\n",
    "client/package.json": '{"scripts":{"dev":"next dev"}}',
    "client/package-lock.json": '{"lockfileVersion":3}',
    "client/tsconfig.json": '{"compilerOptions":{"strict":true}}',
    "client/next.config.ts": "export default {};",
  });
  const ctx = collectProjectContext(dir);

  assert.equal(
    ctx.packageManager,
    "npm",
    "the lockfile sits next to the manifest, not at the root",
  );
  assert.equal(ctx.appRoot, "client");
  assert.ok(ctx.files.some((f) => f.path === "client/package.json"));
  assert.match(renderProjectContext(ctx), /next dev/);
});

test("tells the model commands run from the nested directory", () => {
  const dir = project({
    "client/package.json": '{"scripts":{"dev":"next dev"}}',
  });
  const out = renderProjectContext(collectProjectContext(dir));
  assert.match(out, /<app-root>client\//);
  assert.match(
    out,
    /cd client/,
    "otherwise it will answer `npm run dev` and be wrong",
  );
});

test("a root manifest still wins over a nested one", () => {
  const dir = project({
    "package.json": '{"name":"root-app"}',
    "client/package.json": '{"name":"nested-app"}',
  });
  const ctx = collectProjectContext(dir);
  assert.equal(
    ctx.appRoot,
    undefined,
    "no prefix needed when the app is at the root",
  );
  assert.equal(ctx.files[0]!.path, "package.json");
});

test("does not drag in every package of a deep monorepo", () => {
  const files: Record<string, string> = { "package.json": "{}" };
  for (const p of ["a", "b", "c", "d"])
    files[`packages/${p}/package.json`] = "{}";
  const ctx = collectProjectContext(project(files));
  const manifests = ctx.files.filter((f) => f.path.endsWith("package.json"));
  assert.ok(
    manifests.length <= 2,
    `one level only, got ${manifests.map((m) => m.path).join(", ")}`,
  );
});

test("reads manifest-shaped configs that carry no .config. in the name", () => {
  // shadcn's components.json names the component library and path aliases —
  // it answers design-system slots and matched nothing until now.
  const out = render(
    project({
      "package.json": "{}",
      "components.json":
        '{"style":"new-york","aliases":{"components":"@/components"}}',
      ".nvmrc": "22.12.0",
    }),
  );
  assert.match(out, /new-york/);
  assert.match(out, /22\.12\.0/);
});

test("reads deployment config, which is the only place deploy targets live", () => {
  const out = render(
    project({ "package.json": "{}", "vercel.json": '{"regions":["fra1"]}' }),
  );
  assert.match(out, /fra1/);
});

test("reads the PR template when there's no CONTRIBUTING.md", () => {
  const out = render(
    project({
      "package.json": "{}",
      ".github/PULL_REQUEST_TEMPLATE.md": "## Checklist\n- [ ] Tests added\n",
    }),
  );
  assert.match(out, /Tests added/);
});

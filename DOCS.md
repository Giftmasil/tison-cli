# tison — full documentation

Everything the CLI does, every flag, and what to do when it goes wrong.

If you just want to get going, the [README](README.md) is shorter.

---

## Contents

- [Requirements](#requirements)
- [Installing](#installing)
- [Quick start](#quick-start)
- [The idea](#the-idea)
- [The two kinds of marker](#the-two-kinds-of-marker)
- [Commands](#commands)
  - [tison list](#tison-list)
  - [tison run](#tison-run)
  - [tison generate](#tison-generate)
  - [tison validate](#tison-validate)
  - [tison doctor](#tison-doctor)
  - [tison fill](#tison-fill)
  - [tison draft](#tison-draft)
- [Configuration](#configuration)
- [What fill reads from your project](#what-fill-reads-from-your-project)
- [How fill decides what to write](#how-fill-decides-what-to-write)
- [What the templates contain](#what-the-templates-contain)
- [Editing the templates](#editing-the-templates)
- [Using tison in CI](#using-tison-in-ci)
- [What it costs](#what-it-costs)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Programmatic API](#programmatic-api)
- [FAQ](#faq)

---

## Requirements

- **Node.js 22.12 or newer.** `node --version` to check.
- **Git**, so you can undo what tison writes. Not required, strongly advised.
- **An OpenRouter API key**, but only for `fill` and `draft`. Everything else
  works offline.

Contributing to tison itself additionally needs **Node 22.18+**, because the test
suite runs TypeScript directly.

---

## Installing

Run it once without installing:

```bash
npx tison-cli run enterprise
```

Or install it globally, which gives you the shorter `tison` command:

```bash
npm install -g tison-cli
tison run enterprise
```

Note the package is `tison-cli`; the command it installs is `tison`.

To upgrade: `npm install -g tison-cli@latest`
To remove: `npm uninstall -g tison-cli`

---

## Quick start

From inside a project with a clean git working tree:

```bash
tison run enterprise      # scaffold the context files
tison fill --dry-run      # see what your repo can answer — free, no API call
tison fill                # answer it
tison validate            # list what's left for you
```

To undo everything:

```bash
git checkout . && git clean -fd
```

---

## The idea

Every AI coding agent — Claude Code, Cursor, Codex, Gemini CLI, Aider — reads a
Markdown context file at the start of a session. What's in that file shapes
everything the agent does next.

Two problems follow. Writing a good one is tedious, so most repos don't have one.
And asking an AI to write one for you makes things *worse*: research from ETH
Zurich in 2026 measured LLM-generated context files reducing agent task success,
while adding roughly 20% to the cost per task. The single most common flaw was a
repository overview, present in nearly every generated file and helping in none
of them.

So tison inverts it. The templates are written by hand, once, and hold only what
an agent cannot infer from your code: exact commands, hard constraints,
intentional divergences from convention, and numbered procedures. The parts that
vary per project are marked, and a model fills in only the ones it can actually
read out of your repo.

The thinking happens once, when a template is written. Scaffolding a project
after that is free.

---

## The two kinds of marker

This is the part worth understanding before anything else.

```markdown
- Test: `[TODO(tison): the command that runs the whole suite]`
- [TODO(tison:human): logging levels, and what must never be logged.]
```

**`[TODO(tison): ...]` is a blank.** It's a fact about your project sitting in a
manifest or visible in your file tree. `tison fill` answers these.

**`[TODO(tison:human): ...]` is yours.** Import boundaries, module ownership, a
numbered procedure, a code example — things needing judgment, or several lines
of prose. tison:

- never sends these to a model,
- never counts them as unfilled failures,
- makes **no API call at all** for a file that contains nothing else,
- and strips their text out of the document before it goes anywhere, replacing
  it with `[TODO(tison:human): reserved]`, so a hint you'd rather not hand to a
  model doesn't travel.

That last point matters if you write something candid in one. It stays on your
machine.

The human markers are also, per the research, the content that most helps an
agent. A machine can tell you the build command. It cannot tell you that the
route layer must never import the data layer directly.

---

## Commands

Every command takes `-h` / `--help`.

The command comes first, then its argument: `tison run mvp`, never `tison mvp run`.

### tison list

Shows the available template sets and the docs inside each.

```bash
tison list
```

No flags. Never touches the network.

---

### tison run

Scaffolds a whole template set into a project.

```bash
tison run <category> [options]
```

| Flag | Default | Meaning |
|---|---|---|
| `-o, --output <dir>` | `.` | Directory to write into |
| `-f, --force` | off | Overwrite files that already exist |
| `-d, --dry-run` | off | Show what would be written, write nothing |
| `-y, --yes` | off | Don't ask where to put things |

Existing files are **skipped, not overwritten**, unless you pass `--force`. If you
already have a hand-written `AGENTS.md`, it survives.

**If your app lives one directory down** — `client/`, `web/`, `server/`, `app/` —
tison notices and asks where the context files should go:

```
  No project manifest here. Found one under:

    client/  (package.json, npm)

Where should the context files go?

  > 1. client/  — beside the code an agent will edit
    2. here  — one file covering the whole repository
```

Both answers are legitimate. A root file covers the whole repo and is what an
agent opening it reads first; a nested one wins under "nearest file" resolution,
which is how most agents pick. Choose based on whether the repo is one app or
several.

The prompt is skipped entirely when there's no TTY, so CI never hangs. `--yes`
skips it too.

---

### tison generate

Applies a single doc rather than a whole set.

```bash
tison generate <doc> [options]
```

| Flag | Default | Meaning |
|---|---|---|
| `-c, --category <name>` | `mvp` | Which set the doc comes from |
| `-o, --output <dir>` | `.` | Directory to write into |
| `-f, --force` | off | Overwrite if it exists |
| `-d, --dry-run` | off | Preview only |

The doc names are the `docs:` line in `tison list` — `agents`, `claude`,
`testing`, `architecture`, `design-system`, `conventions`, `adr`, `reviewer`,
`planner`.

```bash
tison generate testing -c enterprise
```

---

### tison validate

Scans your context files for problems. Never touches the network.

```bash
tison validate [path] [options]
```

| Flag | Default | Meaning |
|---|---|---|
| `-s, --strict` | off | Treat warnings as failures |

It looks at `AGENTS.md`, `CLAUDE.md`, everything under `docs/`, and everything
under `.claude/`, and reports:

| Rule | Severity | Why |
|---|---|---|
| `unfilled-todo` | warning | A marker still holds a placeholder. Says which kind. |
| `too-long` | warning | Over 150 lines. Shorter context files get followed more. |
| `possible-secret` | **error** | Looks like a committed credential. |

The secret rules are `credential-url` (a connection string carrying a password),
`private-key`, `aws-access-key`, `openai-style-key`, `github-token`, and
`assigned-secret`. **The matched text is never printed** — only the rule name and
the line number — so running `validate` in CI can't leak the secret into a log.

**Exit codes:** `0` clean, `1` if there are errors, or if `--strict` and there are
warnings.

---

### tison doctor

Verifies the AI setup end to end with one tiny call.

```bash
tison doctor [options]
```

| Flag | Default | Meaning |
|---|---|---|
| `-m, --model <slug>` | configured | Test a specific model |
| `--offline` | off | Check configuration only, make no call |

A green `doctor` proves four things at once: the key works, the model slug
resolves, the network path is open, and the model honours strict JSON schema
output. Every one of those is something `fill` depends on.

Costs a fraction of a cent. `--offline` costs nothing.

**Exit codes:** `0` if the path works, `1` otherwise.

---

### tison fill

Reads your project and fills the blanks.

```bash
tison fill [path] [options]
```

| Flag | Default | Meaning |
|---|---|---|
| `--file <path...>` | all | Only fill these files, relative to the project root |
| `-d, --dry-run` | off | Show what would be sent. **No call, no writes, no cost.** |
| `-m, --model <slug>` | configured | Use a different model |
| `--max-tokens <n>` | auto | Ceiling on each reply |
| `-v, --verbose` | off | Show every slot and exactly what came back |

**Always start with `--dry-run`.** It's free and it tells you which files it will
read, how many markers it found, and how they split between askable and yours.

```bash
tison fill --dry-run
tison fill --file docs/testing.md --verbose
tison fill
```

`--file` takes paths relative to the directory you pass, so `docs/testing.md`,
not `client/docs/testing.md` when you've already said `tison fill client`.

**Safe to re-run.** A filled marker is gone, so a second run only sends what's
left. Running it twice costs nothing extra.

**Writes are atomic.** Each document goes to a temp file and is renamed into
place, so an interrupted run can't leave a half-rewritten file. If the rename is
refused — Windows does this when an editor or antivirus holds the file open —
it falls back to a direct write rather than losing your document.

**Exit codes:** `0` normally, `1` if a file failed or there was nothing to read.

---

### tison draft

Lays out a new document type that no template covers.

```bash
tison draft <topic> [path] [options]
```

| Flag | Default | Meaning |
|---|---|---|
| `--about <text>` | — | Extra steer on what to cover |
| `-o, --output <dir>` | project dir | Where to write |
| `-p, --print` | off | Print instead of writing |
| `-f, --force` | off | Overwrite an existing file |
| `-m, --model <slug>` | configured | Use a different model |

```bash
tison draft deployment --print          # preview
tison draft deployment                  # writes docs/deployment.md
tison draft "incident response"         # writes docs/incident-response.md
```

The output is a **skeleton**: section headings and labelled blanks, nothing else.
It writes no rules, no steps and no prose, because those are the parts a model
can't know. Then `tison fill` answers what your repo supports and you write the
rest.

Constraints applied to whatever comes back:

- Overview, Introduction, About, Background, Summary and Getting Started sections
  are **deleted**, and it tells you it did. These are the content the research
  found unhelpful.
- At most 6 sections, 8 blanks each, 120 lines total.
- A blank asking for the **value of a secret** is refused — this file gets
  committed. Asking what the environment variable is *called*, or where the
  secret is configured, is fine.
- An example smuggled into a hint is stripped, because a hint that contains its
  own answer makes the blank pointless.
- If nothing usable comes back, nothing is written.

Treat the result as a starting point you edit. If one turns out well, promote it
into `templates/` by hand as a real category doc.

---

## Configuration

`fill` and `draft` need an OpenRouter key. Nothing else does.

### Getting a key

1. Sign up at [openrouter.ai](https://openrouter.ai)
2. **Settings → Keys → Create Key**
3. Set a **Credit limit** on the key — `1` is plenty — so a bug can't cost you
   more than a dollar
4. New accounts get a small free allowance; a whole run costs about a cent

### Setting it

A `.env` file in the project (make sure it's gitignored):

```
OPENROUTER_API_KEY=sk-or-v1-...
```

Or an environment variable:

```bash
# macOS / Linux
export OPENROUTER_API_KEY="sk-or-v1-..."

# Windows PowerShell, this session only
$env:OPENROUTER_API_KEY = "sk-or-v1-..."

# Windows PowerShell, permanently — open a NEW window afterwards
setx OPENROUTER_API_KEY "sk-or-v1-..."
```

`setx` only affects windows opened *after* it runs. That trips everyone up once.

### All variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Required by `fill` and `draft` |
| `TISON_MODEL` | `deepseek/deepseek-v4-flash` | Any model supporting strict `json_schema` |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | For an OpenAI-compatible proxy |
| `TISON_HTTP_REFERER` | — | Optional app attribution on OpenRouter |
| `TISON_APP_TITLE` | — | Optional app attribution on OpenRouter |

### Precedence

A real environment variable beats a `.env` file. `.env` is read from **both** the
project you're filling and the directory you ran the command from, with the
project winning. So `tison fill ../other-repo` works whether the key is in either
place.

### Choosing a model

It must support strict `json_schema` output. Check the current list at
[openrouter.ai/models?supported_parameters=structured_outputs](https://openrouter.ai/models?supported_parameters=structured_outputs).

```bash
tison doctor -m z-ai/glm-4.7-flash      # try one before committing to it
TISON_MODEL=z-ai/glm-4.7-flash tison fill
```

tison sends `provider.require_parameters: true`, which stops OpenRouter routing
to a provider that would quietly downgrade strict schema mode. It also disables
the model's reasoning tokens, because those bill at the output rate and
deliberating over "what is the test command" is money for nothing.

---

## What fill reads from your project

In priority order, until a 40,000-character budget runs out:

| What | Why |
|---|---|
| `package.json`, `deno.json` | Commands, dependencies, package manager |
| `README` | The only place that says what the project *is* |
| `CONTRIBUTING.md` | Branch naming, PR rules, review norms |
| `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, `pom.xml`, `build.gradle`, `mix.exs`, `pubspec.yaml`, `requirements.txt` | Non-JS manifests |
| `.github/workflows/*.yml` | What must pass before merge |
| `pnpm-workspace.yaml`, `turbo.json`, `nx.json`, `lerna.json`, `tsconfig.json` | Workspace layout |
| Any root `*.config.*` | Catches next, vite, vitest, drizzle, tailwind, eslint, playwright — without naming any of them |
| `components.json`, `biome.json`, `.eslintrc*`, `.prettierrc*`, `.editorconfig`, `.nvmrc`, `renovate.json` | Tooling configs that aren't `.config.`-shaped |
| `vercel.json`, `netlify.toml`, `fly.toml`, `render.yaml`, `railway.json`, `Procfile`, `wrangler.toml` | Where and how it deploys |
| `schema.prisma`, `schema.rb`, `schema.sql`, `models.py`, `knexfile.*`, `ormconfig.*`, `alembic.ini` | Data models, whichever ORM |
| `Makefile`, `justfile`, `Taskfile`, `Dockerfile`, `docker-compose.yml` | Build and run entry points |
| `.github/PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS` | PR conventions |

Plus a **file tree**, breadth-first, three levels deep, capped at 300 entries.

Manifests are found at the repo root **or one directory down**, so `client/package.json`
works. When the manifest isn't at the root, tison tells the model so — otherwise
it would confidently answer `npm run dev` for a project where the only correct
answer is `cd client && npm run dev`.

The package manager comes from the lockfile, wherever the lockfile is.

### What it never reads

- `.env` and every `.env.*` variant — **except** `.env.example`, `.sample`,
  `.template`, `.dist`, which are committed and hold no values
- `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, keystores
- `id_rsa`, `id_ed25519`, `credentials`, `.npmrc`, `.netrc`, `.pypirc`, `secrets.yaml`
- `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `.nuxt`, `coverage`,
  `vendor`, `target`, `venv`, `__pycache__`, and friends

**It never reads your source code.** Manifests answer nearly every marker; source
files answer almost none and cost a great deal. Your `.ts` and `.py` files appear
as filenames in the tree and nothing more.

---

## How fill decides what to write

Each blank ends in one of four states.

### Filled

A value was written. Under `--verbose` it's labelled by provenance:

- **read** — the value appears verbatim in your files
- **inferred** — it doesn't. Usually a real convention the model knows (like
  `kebab-case`, read off your directory names, or `npx prisma migrate deploy`
  when your repo never states it). Often right. **Check these first.**

The summary tells you how many were inferred.

### Abstained

The model returned an empty string. The marker is left exactly as it was.

This is a designed outcome, not a failure. If your repo doesn't say who approves
a release, no amount of prompting should invent one. An unfilled marker is
honest; an invented one is a false statement in your repo that an agent will act
on later.

Expect heavy abstention on `architecture.md` and on `testing.md` in a repo with
no tests. That's correct behaviour.

### Rejected

A value came back and tison refused to write it. The reason is printed. The rules:

| Reason | What triggered it |
|---|---|
| `looks like a credential` | The value matches a secret pattern. Refused however well sourced — a README often shows a sample connection string, and copying it into `docs/` is how it gets committed for real. |
| `"X" appears nowhere in the project files` | A number in the value isn't in your repo at all. Catches invented dates and versions. |
| `a number is attached to "X", which the files never state` | Part of the value is inferred and part is a number. This is the classic `shadcn/ui ^4.1.1` failure — the library name is right, and the version belongs to a different package. |
| `the number sits far from the rest of the value` | The number and the rest of the value are in different parts of your project. Looks assembled. |
| `value spans multiple lines` | Markers are inline slots. |
| `echoed the marker back` | The model returned the placeholder instead of a value. |
| `slots hold values, not prose` | Over 400 characters. |

These checks only apply to values **containing a digit**, because that's where
the observed fabrications live, and because a value derived from structure —
`kebab-case` — can't be found in the source at all and mustn't be punished for it.

### Reserved

A `[TODO(tison:human)]` marker. Never sent, never counted against the fill rate.

---

## What the templates contain

### `mvp`

For a fast-moving prototype. Three files.

| File | Holds |
|---|---|
| `AGENTS.md` | One-line project identity, stack, five commands, a short "MVP mode" stance, a Never list |
| `CLAUDE.md` | One line: `@AGENTS.md` |
| `docs/conventions.md` | Naming, structure, errors, git |

### `enterprise`

For a production or team codebase. Nine files.

| File | Holds |
|---|---|
| `AGENTS.md` | Project identity, stack, seven exact commands, and **Always / Ask first / Never** gates. The Ask-first block is the differentiator: schema changes, dependency changes, anything touching auth, destructive commands, infra. |
| `CLAUDE.md` | `@AGENTS.md` |
| `docs/testing.md` | Commands including single-test, the ~70/20/10 layer split, what to mock and what not to, fixtures, CI gates, a flaky-test policy |
| `docs/architecture.md` | Import boundaries, module map, integration points, numbered cross-cutting workflows, ADR pointer. **Deliberately no prose overview.** Mostly human markers. |
| `docs/design-system.md` | Component library, where shared components live, design tokens, WCAG 2.2 AA rules, do/don't |
| `docs/conventions.md` | Naming split three ways, structure, errors and logging, commits, branches |
| `docs/adr/0001-...md` | A Nygard-style ADR seed |
| `.claude/agents/code-reviewer.md` | A read-only reviewer sub-agent — Critical / Warnings / Suggestions |
| `.claude/agents/planner.md` | A read-only planner sub-agent that never edits |

`AGENTS.md` holds the real content because it's the portable standard read by
30+ agents. `CLAUDE.md` imports it rather than duplicating it, so Claude Code
users get the same content from one source. They are two real files, not
symlinks, because Windows symlinks need privileges.

---

## Editing the templates

The templates are the product. Editing them for your team is expected.

They live inside the installed package. To find them:

```bash
npm root -g          # then look in tison-cli/templates/
```

Better: clone the repo, edit `templates/`, and use your fork.

A category is a folder under `templates/` containing a `template.json`:

```json
{
  "category": "backend-api",
  "description": "Node service with a database.",
  "files": [
    { "src": "AGENTS.md", "doc": "agents" },
    { "src": "docs/testing.md", "doc": "testing" }
  ]
}
```

`src` is the path inside the category folder, `doc` is the short name used by
`tison generate <doc>` and shown in `tison list`. Add `dest` if it should land
somewhere different from `src`.

### Writing good markers

- **Use `[TODO(tison): ...]` when a manifest or the file tree answers it.**
  Commands, paths, package names, casing conventions, CI checks.
- **Use `[TODO(tison:human): ...]` when it needs judgment or several lines.**
  Import boundaries, ownership, procedures, code examples, policies.
- **Ask one thing per marker.** `where code goes; feature-folder vs
  layer-folder; co-location rules` is three questions, and a model that can only
  answer one of them answers none.
- **Don't put the answer in the hint.** `the seed command, e.g. npx prisma db
  seed` answers itself.
- **Wrap command markers in backticks** — `` `[TODO(tison): the build command]` ``
  — and tison will return a bare value with no backticks of its own.
- **Keep files under 150 lines.** `validate` warns past that, and a 60-line file
  an agent follows beats a 300-line one it ignores.

---

## Using tison in CI

`validate` is the one to run. It needs no key and no network.

```yaml
- run: npx tison-cli validate --strict
```

`--strict` fails the build on unfilled markers and over-long files as well as on
secrets. Without it, only secrets fail.

Don't run `fill` in CI. It costs money on every build and its output needs a
human to read it.

Every prompt is skipped when there's no TTY, so `run` never hangs a pipeline.
Use `--yes` to be explicit about it.

---

## What it costs

| Operation | Typical |
|---|---|
| `run`, `generate`, `list`, `validate` | Free — no network at all |
| `fill --dry-run`, `doctor --offline` | Free |
| `doctor` | ~$0.00002 |
| `fill` on a full enterprise set | ~$0.002 |
| `draft` | ~$0.001 |

Roughly a cent for everything, on the default model.

Costs are shown per run. To check what you've spent overall:

```bash
node -e "fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:'Bearer '+process.env.OPENROUTER_API_KEY}}).then(r=>r.json()).then(d=>console.log(d.data))"
```

tison keeps costs down by sending only manifests and a bounded tree, disabling
reasoning tokens, pinning every call in a run to one provider so the prompt cache
stays warm, and making no call at all for a file whose markers are all reserved
for a human.

---

## Troubleshooting

### `no OPENROUTER_API_KEY found`

Not set, or set in a different window. On Windows, `setx` only affects windows
opened afterwards — open a new one. Check with `echo $env:OPENROUTER_API_KEY`
(PowerShell) or `echo $OPENROUTER_API_KEY` (bash).

Remember `.env` is read from the project you're filling and from where you ran
the command — but not from a third directory.

### `[auth] OpenRouter rejected the key (401)`

The key is wrong, revoked, or has a stray space. Check it at
[openrouter.ai/settings/keys](https://openrouter.ai/settings/keys). An OpenRouter
key starts `sk-or-` and is 73 characters.

### `[credits] OpenRouter says the account is out of credits (402)`

Top up, or you've hit the credit limit you set on the key. Both are at
[openrouter.ai/settings/credits](https://openrouter.ai/settings/credits).

### `[request] OpenRouter rejected the request (400)`

Usually a model slug that doesn't exist, or one that doesn't support strict
`json_schema`. Check it against
[the filtered model list](https://openrouter.ai/models?supported_parameters=structured_outputs),
and try `tison doctor -m <slug>` before a full run.

### `[response] the reply hit the max_tokens ceiling`

Rare — the ceiling scales with marker count and retries once at double. If you
see it, raise it: `tison fill --max-tokens 16000`.

### `Nothing to fill here — no [TODO(tison)] markers found`

Either everything is filled, or you're in the wrong directory. tison looks one
level down and will tell you if it finds markers in a subfolder.

### `no project manifest found here`

No `package.json` or equivalent in the directory you pointed at. If your app is
in a subfolder, run `tison fill client` (or whatever it's called). `tison fill
--dry-run` lists exactly which files it can see.

### Everything abstained

Look at the manifest list in the output. If it says "nothing — no manifests
found", tison has nothing to read. If it lists your files and it still abstained,
the answers genuinely aren't in your repo — which is itself worth knowing.

### It filled something wrong

Please open an issue with the marker hint, the value, and what it should have
been. The verification rules are built from real failures and that's how they get
better.

### `Cannot find module './x.js'`

You're building from source and your editor rewrote an import. This project uses
`nodenext`, so relative imports must end `.js` even in `.ts` files. Add to
`.vscode/settings.json`:

```json
{ "typescript.preferences.importModuleSpecifierEnding": "js" }
```

### `npm test` runs zero tests

The test script needs the glob quoted: `node --test "dist-test/**/*.test.js"`.
A bare directory argument reports one passing test and runs nothing.

---

## Security

**Your key never leaves your machine except to OpenRouter.** tison has one
runtime dependency (commander) and makes exactly one kind of outbound request.
The key is never logged, never included in an error message, and is redacted
when `doctor` displays it.

**Credential files are never read.** `.env` and its variants, private keys,
`.npmrc`, `.netrc` and friends are excluded from the file tree before anything is
sent — they aren't even listed.

**Credentials are never written.** A value matching a secret pattern is refused
even when it's well sourced, because a README showing a sample connection string
makes it easy to copy one into a committed document.

**Human-only marker text never travels.** It's redacted from the document before
it's sent, and there's a test in the suite that fails the build if a human
marker's text appears in any outbound payload.

**Every write is contained.** Paths are resolved and proven to stay inside the
output directory using `path.relative`, not merely joined — `path.join` is not a
security boundary.

**Repo content is treated as data, not instructions.** The prompts say so
explicitly. And because the model only ever returns short strings that tison
splices at offsets it computed itself, a hostile value can't restructure a
document. There's a test for that too.

To report a vulnerability, use GitHub's private vulnerability reporting on the
repo rather than a public issue.

---

## Programmatic API

Everything is exported from the package root, if you want to build on it.

```js
import {
  applyDocs, readManifest, listCategories,
  parseMarkers, applyFills, redactHumanMarkers,
  collectProjectContext, renderProjectContext,
  findPendingFiles, fillProject, verifyFills,
  draftDocument, normaliseDraft, renderDraft,
  detectProjects, validateDir,
  OpenRouterClient, readAiEnv,
} from "tison-cli";
```

Example — find every unfilled marker without touching the network:

```js
import { findPendingFiles } from "tison-cli";

for (const file of findPendingFiles(process.cwd())) {
  const askable = file.markers.filter((m) => !m.humanOnly).length;
  console.log(`${file.path}: ${askable} askable, ${file.markers.length - askable} yours`);
}
```

---

## FAQ

**Do I have to pay for this?**
Only for `fill` and `draft`, and only about a cent per project. `run`,
`generate`, `list` and `validate` are free and offline. The templates alone are
most of the value.

**Why do I need my own API key?**
Because a key shipped inside a public npm package is extracted within hours, and
because otherwise the author pays for every stranger's runs. Every tool in this
space works the same way. For a team, OpenRouter has organisation accounts with
per-member provisioning keys and spend caps.

**Does it send my source code anywhere?**
No. Manifests and a file tree only. Never `.env`, never `.pem`, never your `.ts`
files.

**Why did it leave so many markers blank?**
Because your repo doesn't state those things. That's the design. Check the
manifest list in the output — if it found nothing to read, you're probably
pointed at the wrong directory.

**Can I use a different model?**
Yes, `TISON_MODEL` or `-m`. It must support strict `json_schema` output.

**Is it safe to run twice?**
Yes. A filled marker is gone, so a second run only sends what's left.

**How do I undo it?**
`git checkout . && git clean -fd`, which is why a clean working tree first is
worth the ten seconds.

**Can I add my own templates?**
Yes — a folder under `templates/` with a `template.json`. See
[Editing the templates](#editing-the-templates).

**Why two files, `AGENTS.md` and `CLAUDE.md`?**
`AGENTS.md` is the portable standard read by 30+ agents. `CLAUDE.md` is what
Claude Code reads natively. The second imports the first, so there's one source
of truth. They're two real files rather than a symlink because Windows symlinks
need privileges.
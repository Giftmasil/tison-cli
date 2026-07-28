# tison

Scaffold curated AI-context files — `AGENTS.md`, `CLAUDE.md`, testing and
architecture docs, sub-agents — into a project from hand-crafted templates, then
fill in the project-specific details by reading your repo.

```bash
npx tison-cli run enterprise
```

## Why

AI coding agents read a Markdown context file at the start of every session, and
the quality of that file decides how well the agent works. Good ones are tedious
to write, and research shows that **verbose, auto-generated ones actively hurt** —
agents follow every instruction, so extra detail makes tasks slower and more
expensive ([ETH Zurich, 2026](https://arxiv.org/abs/2602.11988)).

tison ships the opposite: short, hand-curated templates holding only what an
agent can't infer from your code — exact commands, hard constraints, team
conventions — with clearly marked spots for the project-specific details.

## Install

```bash
npx tison-cli run mvp          # run without installing

npm install -g tison-cli       # or install globally
tison run mvp
```

Requires Node.js 22.12 or newer.

## Usage

```bash
tison list                     # available template sets and what's in each
tison run enterprise           # scaffold a set into this project
tison generate testing -c enterprise   # add a single doc later
tison fill --dry-run           # see what your repo can answer — free
tison fill                     # answer it
tison validate                 # list what's still unfilled
```

The command comes first, then the category: `tison run mvp`, not `tison mvp run`.
Files land in the current directory unless you pass `--output <dir>`.

If your app lives one directory down — `client/`, `web/`, `server/` — `run` will
notice, say so, and ask where the context files should go.

## Template sets

**`mvp`** — a lean setup for a prototype: a short `AGENTS.md`, a `CLAUDE.md` that
imports it, and a minimal conventions doc.

**`enterprise`** — the full production set: a command-first `AGENTS.md` with
explicit _Always / Ask first / Never_ gates, plus `docs/testing.md`,
`docs/architecture.md`, `docs/design-system.md`, `docs/conventions.md`, an ADR
seed, and read-only `code-reviewer` and `planner` sub-agents under
`.claude/agents/`.

`AGENTS.md` holds the real content — it's the portable standard most agents read
— and `CLAUDE.md` is a one-line file that imports it, so Claude Code users get
the same content without duplication.

## Two kinds of marker

Templates contain two kinds of placeholder, and the difference is the point:

```markdown
- Test: `[TODO(tison): the command that runs the whole suite]`
- [TODO(tison:human): logging levels, and what must never be logged.]
```

`[TODO(tison): ...]` is a **blank** — a fact about your project that can be read
out of your manifests and file tree. `tison fill` answers these.

`[TODO(tison:human): ...]` is **yours**. Import boundaries, module ownership, a
numbered procedure, a code example: things that need judgment or several lines
of prose. These are never sent to a model, never counted as failures, and if a
document has nothing else in it, no API call is made at all. Their text is
stripped from the document before it goes anywhere, so a hint you'd rather not
hand to a model doesn't travel.

That second kind is the content the research says actually helps an agent. It's
also the content only you can write.

## Filling

```bash
tison fill --dry-run     # what would be sent, and what it would cost — no call
tison fill               # fill the blanks
tison fill --verbose     # show every slot and exactly what came back
tison validate           # what's left
```

`fill` reads your manifests — `package.json`, README, `tsconfig.json`, CI
workflows, the ORM schema whichever ORM you use, `components.json`, the lockfile
— plus a bounded file tree. It writes through a temp file and a rename, so an
interrupted run can't leave a document half-rewritten, and it's safe to re-run:
a filled marker is simply gone.

**A blank it can't answer stays a blank.** If your repo doesn't say who approves
a release, that slot is left alone. Unfilled is honest; invented is a lie your
agent will act on.

### What it refuses to write

A model's most convincing mistake is welding two true facts into a false one —
`shadcn/ui ^4.1.1`, where the library is right and the version belongs to
Tailwind. So `fill` checks each value against your files before writing it:

- a number that appears nowhere in your project is refused
- a number attached to a word your files never state is refused
- a number sitting far from the rest of its value is refused
- anything shaped like a credential is refused outright, however well sourced

Values it does write are labelled. Anything that doesn't appear verbatim in your
files is marked `(inferred)` under `--verbose` — a real convention the model
knows rather than something it read. Usually right, worth checking first.

### New doc types

For a document no template covers:

```bash
tison draft deployment --print    # preview
tison draft deployment            # writes docs/deployment.md
tison fill                        # answer the blanks it created
```

`draft` produces a **skeleton**: section headings and labelled blanks, nothing
else. It writes no rules, no steps and no prose, because those are the parts a
model can't know and shouldn't guess. Overview sections are stripped, and a
blank asking for the _value_ of a secret is refused — a blank asking what the
environment variable is called is fine.

Treat the output as a starting point you edit, not a finished document. If one
turns out well, promote it into `templates/` by hand as a real category doc.

## Setting up the AI commands

`fill` and `draft` need an [OpenRouter](https://openrouter.ai) key. Everything
else — `run`, `generate`, `list`, `validate` — works offline with no key.

```bash
cp .env.example .env    # then paste your key in
tison doctor            # verify it end to end, for a fraction of a cent
```

| Variable              | Default                        | Purpose                                   |
| --------------------- | ------------------------------ | ----------------------------------------- |
| `OPENROUTER_API_KEY`  | —                              | required by `fill` and `draft`            |
| `TISON_MODEL`         | `deepseek/deepseek-v4-flash`   | any model supporting strict `json_schema` |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | for an OpenAI-compatible proxy            |

Real environment variables beat `.env`, and `.env` is read from both the project
you're filling and the directory you ran from. Filling a whole project costs
about a cent. Set a per-key credit limit on OpenRouter if you want a hard ceiling.

## Commands

| Command                 | What it does                                           |
| ----------------------- | ------------------------------------------------------ |
| `tison run <category>`  | Scaffold every file in a category                      |
| `tison generate <doc>`  | Add a single doc (`-c` picks the category)             |
| `tison list`            | List categories and their docs                         |
| `tison validate [path]` | Flag unfilled markers, over-long files, likely secrets |
| `tison fill [path]`     | Fill blanks by reading your project                    |
| `tison draft <topic>`   | Lay out a new doc type as headings and blanks          |
| `tison doctor`          | Check the AI setup end to end                          |

Shared flags: `--output <dir>`, `--force`, `--dry-run`. `validate` adds
`--strict` (warnings fail too, for CI). `fill` adds `--verbose` and `--file`.

## Validate

`tison validate` scans `AGENTS.md`, `CLAUDE.md`, `docs/`, and `.claude/`:

- **unfilled markers** (warning), noting which are reserved for a person
- **files over 150 lines** (warning — shorter context files get followed more)
- **likely committed secrets** (error — reported by line and rule only, never
  echoing the value)

Secrets exit non-zero by default; `--strict` makes warnings fail too.

## Philosophy

Curated, not generated. The thinking happens once, when the templates are
written, so scaffolding costs nothing and produces something consistent —
instead of asking a model to draft the same docs every time and hoping.

Where a model is involved it fills blanks and proposes headings. It never writes
a claim about your project that your repo didn't supply, and it never gets to
restructure a document you curated by hand.

## Development

```bash
npm run build       # compile to dist/
npm test            # compile to dist-test/ and run the suite
npm run typecheck   # whole project, tests included
```

Tests need Node 22.18 or newer. Published packages don't include them.

## Roadmap

- More categories: backend API, frontend web, mobile, monorepo.
- A `.tisonrc` so a project remembers its category.
- Nested per-package `AGENTS.md` for monorepos.
- A fixtures-based eval harness, so prompt and model changes can be measured
  rather than argued about.

## License

MIT

# tison

Scaffold curated AI-context files — `AGENTS.md`, `CLAUDE.md`, testing and
architecture docs, sub-agents — into a project from hand-crafted templates.
One command, no AI calls, no blank page.

```bash
npx tison-cli run enterprise
```

## Why

AI coding agents (Claude Code, Cursor, Codex, and others) read a Markdown
context file at the start of every session. The quality of that file decides how
well the agent works. But good context files are tedious to write, and research
shows that **verbose, auto-generated ones actually hurt** — agents follow every
instruction, so extra detail just makes tasks slower and more expensive
([ETH Zurich, 2026](https://arxiv.org/abs/2602.11988)).

tison ships the opposite: short, hand-curated templates that hold only what an
agent can't infer from your code — exact commands, hard constraints, and team
conventions — with clearly marked spots for you to fill in the project-specific
details.

## Install

```bash
# run without installing
npx tison-cli run mvp

# or install globally
npm install -g tison-cli
tison run mvp
```

Requires Node.js 22.12 or newer.

## Usage

```bash
tison list                     # see available template sets and what's in each
tison run mvp                  # scaffold the lean MVP set into the current folder
tison run enterprise           # scaffold the full production set
tison generate testing -c enterprise   # add a single doc to an existing project
tison validate                 # check context files for problems
```

The command comes first, then the category: `tison run mvp`, not `tison mvp run`.
Files are written into the current directory unless you pass `--output <dir>`.

## Template sets

**`mvp`** — lean setup for a fast-moving prototype. A short `AGENTS.md`, a
`CLAUDE.md` that imports it, and a minimal conventions doc.

**`enterprise`** — full setup for a production or team codebase: command-first
`AGENTS.md` with explicit *Always / Ask first / Never* gates, plus
`docs/testing.md`, `docs/architecture.md`, `docs/design-system.md`,
`docs/conventions.md`, an ADR seed, and read-only `code-reviewer` and `planner`
sub-agents under `.claude/agents/`.

`AGENTS.md` holds the real content (the portable standard read by most agents);
`CLAUDE.md` is a one-line file that imports it, so Claude Code users get the same
content without duplication.

## Filling in the templates

Templates contain markers like:

```
- Test: `[TODO(tison): e.g. pnpm test]`
```

Each one is a spot for a project-specific value the template can't know. Replace
them with your real commands and paths. To find any you've missed:

```bash
tison validate
```

## Commands

| Command | What it does |
| --- | --- |
| `tison run <category>` | Scaffold every file in a category |
| `tison generate <doc>` | Add a single doc (`-c` picks the category) |
| `tison list` | List categories and their docs |
| `tison validate [path]` | Flag unfilled markers, over-long files, and likely secrets |

Shared flags: `--output <dir>`, `--force`, `--dry-run`. `validate` adds
`--strict` (treat warnings as failures, for CI).

## Validate

`tison validate` scans `AGENTS.md`, `CLAUDE.md`, `docs/`, and `.claude/` and reports:

- **unfilled `[TODO(tison)]` markers** (warning)
- **files over 150 lines** (warning — shorter context files get followed more)
- **likely committed secrets** (error — reported by line and rule only, the value is never printed)

Secrets exit non-zero by default; `--strict` makes warnings fail too.

## Philosophy

Curated, not generated. The thinking happens once, when the templates are
written, so scaffolding a project costs nothing and produces something
consistent — instead of asking an AI to draft the same docs every time and
hoping the output is good.

## Roadmap

- `tison generate <doc> --ai` — fill the `[TODO(tison)]` markers automatically by
  reading your repo, via cheap open models through OpenRouter. (Coming in 0.2.)
- More categories: backend API, frontend web, mobile, monorepo.

## License

MIT

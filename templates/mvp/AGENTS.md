# AGENTS.md

Context for AI coding agents working in this repo. This file is the source of
truth; `CLAUDE.md` imports it. Keep it short — link to `docs/` for detail.

## Project

[TODO(tison): one sentence — what this is and its stage. e.g. "Early MVP web app; optimizing for speed of iteration, not polish."]

Stack: [TODO(tison): language + framework + versions, e.g. TypeScript, Next.js 15, Postgres/Prisma]

## Commands

- Install: `[TODO(tison): e.g. pnpm install]`
- Dev: `[TODO(tison): e.g. pnpm dev]`
- Build: `[TODO(tison): e.g. pnpm build]`
- Test: `[TODO(tison): e.g. pnpm test]`
- Lint: `[TODO(tison): e.g. pnpm lint]`

## How to work here (MVP mode)

This is an MVP. Optimize for shipping and learning, not perfection.

- Prefer the simplest thing that works. Don't add abstraction until it's needed twice.
- Make minimal, focused diffs. Don't refactor code you weren't asked to touch.
- Skip tests for throwaway/exploratory code unless asked. Always test anything touching money, auth, or data loss.
- **Stop and confirm before** schema changes, dependency swaps, or auth changes.
- When in doubt, match the style of nearby files over any external convention.

## More detail

- Conventions: `docs/conventions.md`

## Never

- Never commit secrets, `.env` files, or credentials.
- Never hand-edit lockfiles, generated files, or [TODO(tison): generated dirs, e.g. /migrations, /dist].

# Conventions

Project conventions that aren't already enforced by the linter or formatter.
If your tooling enforces it, don't restate it here.

## Naming

- Files and directories: `[TODO(tison): casing for files and directories, e.g. kebab-case]`
- Components: `[TODO(tison): casing for components, e.g. PascalCase]`
- Variables and constants: `[TODO(tison): casing for variables and constants]`

## Structure

- Feature code lives in: `[TODO(tison): the directory features live under, from the file tree]`
- [TODO(tison:human): co-location rules — what sits next to what, and what must not.]

## Errors & logging

- [TODO(tison:human): how errors are thrown and handled here; never swallow silently.]
- [TODO(tison:human): logging levels, and what must never be logged (no PII/secrets).]

## Commits

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.
- Imperative mood ("add login", not "added login").

## Branches & PRs

- Branch: `[TODO(tison): branch naming pattern, e.g. type/ticket-id/short-desc]`
- One concern per PR. The description says what changed and why.

---

Keep this short. Delete anything obvious or already enforced by tooling.

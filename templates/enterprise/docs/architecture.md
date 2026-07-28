# Architecture

<!-- Keep this file to boundaries, hard rules, and workflows. Do NOT add a prose
     overview of the system: agents read structure from the code, and overviews
     here tend to add cost and exploration without improving results. Put the
     "why" in ADRs.

     Most slots below are marked `tison:human`. They are decisions and multi-line
     answers, so `tison fill` skips them rather than charging you to be told
     nothing. Write them yourself — they are the highest-value lines in the file. -->

## Boundaries

Rules the code must follow that you can't infer from a single file:

- [TODO(tison:human): e.g. the route/web layer must never import the data layer directly — go through services.]
- [TODO(tison:human): e.g. `core/` must not import from `features/`.]
- [TODO(tison:human): any other forbidden import direction.]

## Module map

<!-- One line per top-level module. Add as many lines as you have modules. -->

- [TODO(tison:human): module name — what it owns, in one line.]

## Integration points

<!-- One line per external system: what it is, where it's configured, who owns it. -->

- [TODO(tison:human): external system — where it's configured, which module owns it.]

## Common workflows

How to make cross-cutting changes correctly — this is where agents miss wiring,
and the one kind of architectural content that measurably helps.

- Add a `[TODO(tison): the most common recurring change, e.g. a new API endpoint]`:
  1. [TODO(tison:human): first step.]
  2. [TODO(tison:human): second step.]
  3. [TODO(tison:human): third step.]

## Decisions

Significant, hard-to-reverse choices are recorded as ADRs in `docs/adr/`. Add one
when you make such a decision. Don't edit an accepted ADR — supersede it with a new one.

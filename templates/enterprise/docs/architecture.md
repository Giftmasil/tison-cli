# Architecture

<!-- Keep this file to boundaries, hard rules, and workflows. Do NOT add a prose
     overview of the system: agents read structure from the code, and overviews
     here tend to add cost and exploration without improving results. Put the
     "why" in ADRs. -->

## Boundaries

Rules the code must follow that you can't infer from a single file:

- [TODO(tison): e.g. the route/web layer must never import the data layer directly — go through services.]
- [TODO(tison): e.g. `core/` must not import from `features/`.]
- [TODO(tison): allowed data-flow directions / forbidden imports.]

## Module map

- [TODO(tison): top-level modules, one line each, and who owns what. Keep it short.]

## Integration points

- [TODO(tison): external systems, where each is configured, which module owns it.]

## Common workflows

How to make cross-cutting changes correctly — this is where agents miss wiring:

- Add a [TODO(tison): e.g. new API endpoint]: 1) … 2) … 3) …
- [TODO(tison): another recurring multi-file task and its exact steps.]

## Decisions

Significant, hard-to-reverse choices are recorded as ADRs in `docs/adr/`. Add one
when you make such a decision. Don't edit an accepted ADR — supersede it with a new one.

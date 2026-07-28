# Testing

How tests are organised and run here. The guiding rule: the closer a test
resembles how the software is actually used, the more confidence it gives.

## Commands

- All tests: `[TODO(tison): the command that runs the whole suite]`
- Single test: `[TODO(tison): the command that runs one test file or pattern]`
- Unit only (fast, pre-commit): `[TODO(tison): the command for unit tests only, or leave empty]`
- Coverage: `[TODO(tison): the command that produces a coverage report, or leave empty]`

Prefer running a single test over the whole suite while iterating.

## Layers

Rough target mix:

- ~70-80% unit — single module, no network/DB/filesystem. Fast and deterministic.
- ~15-20% integration — a few modules together. The layer that catches the most real bugs.
- ~5% end-to-end — full flows, used sparingly. Slow, and the first to turn flaky.

Reach for the smallest test that can catch the failure.

## What to mock

- Mock out-of-process dependencies: network, third-party APIs, clock/time.
- Do not mock the thing under test. Avoid asserting on internal implementation
  details — test behaviour and outputs, so refactors don't break the suite.

## Fixtures & data

- Test factories and fixtures live in: `[TODO(tison): the directory holding test fixtures or factories]`
- [TODO(tison:human): the pattern to follow when adding one.]

## CI gates

- Must pass before a PR can merge: [TODO(tison): the checks CI runs on a pull request]

## Flaky tests

A flaky test is worse than no test — it trains the team to ignore red. When a
test flakes: quarantine it, open an issue, and fix or delete it within
[TODO(tison:human): your deadline, e.g. one week]. Don't let it linger.

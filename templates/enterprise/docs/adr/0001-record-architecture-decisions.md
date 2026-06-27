# 1. Record architecture decisions

Date: [TODO(tison): YYYY-MM-DD]

## Status

Accepted

## Context

We need to record the architectural decisions that are expensive to reverse, so
future contributors — human and agent — understand why the system is shaped the
way it is, without reconstructing intent from code.

## Decision

We use Architecture Decision Records, in the style described by Michael Nygard.
Each record is a short Markdown file in `docs/adr/`, numbered in sequence. Once a
decision is Accepted it is immutable; to change it, add a new ADR that supersedes it.

## Consequences

Decisions gain a durable, reviewable history. New contributors read the ADR log
instead of guessing. The log has to be kept current as part of normal work.

# ADR 0001: Three-Agent Code Review Orchestration

**Date:** 2026-05-16
**Status:** Accepted

## Context

The original code review flow used a single `senior-code-reviewer` agent to review the entire PR diff in one pass. As the codebase grew, this produced unfocused findings — React-specific patterns and backend patterns require different expertise, and mixing them in one comment thread reduced review quality for both domains.

## Decision

Replace the single-agent review with a `code-review-orchestrator` that spawns domain specialists (`react-code-reviewer`, `backend-code-reviewer`) only when their domain is touched. The orchestrator owns security review across all files. Agents are global (`~/.claude/agents/`) and project-agnostic, learning per-project conventions via a scoped memory directory.

## Alternatives Considered

- **Single general reviewer:** Simpler, but unfocused. React-specific patterns (stale closures, concurrent rendering) and backend patterns (N+1 queries, migration safety) degrade when reviewed by a generalist.
- **Always run all three reviewers:** Simpler routing but wastes time on unaffected domains.
- **Project-scoped agents:** Would need to be duplicated per project. Rejected in favour of global agents with per-project memory so the methodology is portable.
- **Fix only Critical/High severity:** Requires human intervention for Medium/Low. Rejected in favour of fixing all issues with a test-guarded safety gate.

## Consequences

- PRs touching one domain get focused, faster reviews with less noise.
- PRs touching both domains produce multiple agent comment threads — intentional for traceability.
- Every PR gets a machine-generated final status table (agents run, findings, fixes applied, fixes skipped) as a permanent audit record.
- Failure in one specialist does not block others; the orchestrator degrades gracefully and reports failures on the PR.
- Ambiguous files pause the orchestrator, which asks the human once and caches the routing decision in project memory.

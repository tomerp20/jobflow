# ADR 0001: Three-Agent Code Review Orchestration

**Date:** 2026-05-16
**Status:** Accepted

## Context

The original code review flow used a single `senior-code-reviewer` agent to review the entire PR diff in one pass — security, frontend, backend, and code quality all together. As the review surface grew, this produced unfocused findings and mixed React and backend concerns in a single comment thread with no domain expertise applied to either.

## Decision

Replace the single-agent review with a three-agent orchestration:

1. **`code-review-orchestrator`** — always runs; performs security review itself; detects which files changed using a 3-layer strategy (path heuristics → file content → cached project memory); spawns only the relevant domain specialists; coordinates the three-phase execution; handles failure and runs a verification pass after fixes.

2. **`react-code-reviewer`** — spawned when frontend files change; runs ESLint as a guardrail before semantic analysis; reviews React-specific failure modes (hooks correctness, concurrent rendering, performance, a11y, forms, TypeScript type safety); flags testing gaps in the React domain.

3. **`backend-code-reviewer`** — spawned when backend files change; reviews Node/Express patterns, database logic, migrations, TypeScript type safety, and testing gaps in the backend domain. **Status: planned — not yet implemented.** Until implemented, the orchestrator reviews backend files directly.

**Three-phase execution:**
- **Phase 1 (Review, parallel):** All relevant agents run simultaneously, each posting its own findings as a summary comment plus inline line-level PR comments.
- **Phase 2 (Fix, parallel, after all reviews):** Each domain agent reads the entire PR conversation, applies fixes for all issues in its domain. Fixes are skipped if they risk breaking other features/functionality; tests are run after each fix; a failing test reverts that fix and leaves the original PR comment for human resolution. After all fix commits are pushed, the orchestrator performs a verification pass: it re-fetches the full diff and confirms all Critical and High findings have been addressed. Any regression introduced by a fix is caught here and flagged.
- **Phase 3 (Final status):** The orchestrator posts a summary table on the PR listing which agents ran, how many issues were found, how many were fixed, and which fixes were skipped for human resolution.

**Project-agnostic design:** All three agents live at `~/.claude/agents/` (global scope) so the methodology is portable across projects. File routing uses path heuristics and content analysis, falling back to cached project memory once the onboarding scan has run.

**Per-project learning:**
- **Mechanism 1 — Onboarding scan:** On first run in a project, each agent automatically scans project structure, identifies tech stack and conventions, and writes an initial `MEMORY.md` to its project-scoped memory directory (`.claude/agent-memory/<agent-name>/`).
- **Mechanism 2 — Per-review updates:** After each review, agents update their memory with newly confirmed patterns, recurring issues, and project-specific conventions.

## Alternatives Considered

- **Single general reviewer:** Simpler, but unfocused. React-specific patterns (stale closures, concurrent rendering gotchas) and backend patterns (N+1 queries, migration safety) require domain expertise that degrades in a single-pass review.
- **Single fixer agent reading all findings:** Clean separation of review and fix, but the fixer loses context the reviewer already had. Domain-specific fixers reading the full PR conversation was preferred.
- **Always run all three reviewers:** Simpler routing but wastes time on unaffected domains. A backend-only PR doesn't benefit from a React review pass.
- **Fix only Critical/High severity:** More conservative but requires human intervention for Medium/Low issues. Rejected in favour of fixing all issues with a safety gate (test run + break-risk check).

## Consequences

- PRs touching only one domain get faster, more focused reviews with less noise.
- PRs touching both domains produce a longer PR conversation (multiple agent threads) — intentional and desirable for traceability.
- Ambiguous files (not routable by any heuristic) pause the orchestrator, which asks the human in the chat; the answer is cached in project memory and the question is never asked again for that file/pattern.
- Failure in one specialist does not block others; the orchestrator degrades gracefully, continues, and reports the failure on the PR.
- Every reviewed PR receives a machine-generated final status table from the orchestrator (Phase 3), listing agents run, findings count, fix count, and skipped items. This creates a permanent, auditable record of each review on the PR itself.
- The workflow requires no human intervention except for: ambiguous file routing (once per file, cached), and cases where a fix was skipped due to break risk (left as a PR comment).

# Claude Instructions for JobFlow

## Branch Rule — Applies to ALL Code Changes

**Every code change — feature, bug fix, refactor, experiment, or anything else — must live on a dedicated branch. No exceptions. Never commit directly to `main`.**

If Claude does not know the purpose of the change, it must ask the user before writing any code:
> "Before I start, what is the goal of this change? (new feature, bug fix, refactor, learning experiment, etc.) — I need this to name the branch correctly."

**Branch naming convention by type:**

| Purpose | Prefix | Example |
|---------|--------|---------|
| New feature | `feature/` | `feature/drag-and-drop-cards` |
| Bug fix | `fix/` | `fix/search-not-clearing-filters` |
| Refactor / cleanup | `refactor/` | `refactor/client-side-search` |
| Learning / experiment | `experiment/` | `experiment/use-deferred-value` |
| Chore / config / deps | `chore/` | `chore/upgrade-react-19` |
| Docs | `docs/` | `docs/api-reference` |

Branch off the latest `main` unless the user specifies otherwise:
```bash
git checkout main
git pull origin main
git checkout -b <prefix>/<short-kebab-case-description>
```

---

## Development Workflow

Every code change must follow this exact workflow — no exceptions.

> **Use `/gitflow` to execute Steps 1, 3, 4, and 5 atomically.** This skill runs the full workflow deterministically via pre-written shell scripts — branch creation, commit, push, PR creation, and code review trigger. Invoke it whenever you hear "run the gitflow", "commit and open a PR", "ship this", "push and create a PR", or any equivalent instruction to execute the workflow after implementation is done.

---

### Step 1: Create a Branch

Before writing any code, determine the purpose and create the appropriate branch (see Branch Rule above). If the purpose is unclear, ask first.

---

### Step 2: Implement the Change

Make all code changes on the branch. Keep changes focused — only modify what is necessary for the stated purpose. Do not refactor unrelated code, add unnecessary comments, or over-engineer.

**External dependencies must be verified before use.** If a plan or task requires calling an external API, loading from a third-party URL, or depending on any service outside the codebase, Claude must confirm it is reachable and working before writing code that depends on it. If research agents report that a dependency is unreachable, broken, or returns errors — stop, surface this to the user, and agree on an alternative before proceeding. Never implement code that relies on a dependency known to be broken.

---

### Step 3: Commit the Changes

Stage and commit with a clear, structured commit message.

**Commit message format:**
```
<type>: <concise summary in imperative mood>

<body — what changed and why, not how>
- bullet points for multiple changes
- reference any relevant context

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

**Types:** `feat`, `fix`, `refactor`, `style`, `docs`, `test`, `chore`

Example:
```
feat: add drag-and-drop reordering for kanban cards

- Cards can now be dragged between columns
- Order persists to the backend via PATCH /api/cards/:id
- Drag handle shown on hover to avoid accidental drags
```

Commands:
```bash
git add <specific files>
git commit -m "$(cat <<'EOF'
feat: your message here

- detail 1
- detail 2

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Step 4: Create a Pull Request

Push the branch and open a PR from the branch to `main`.

```bash
git push -u origin <branch-name>
gh pr create --title "<concise PR title>" --body "$(cat <<'EOF'
## Summary
- What this PR does (1-3 bullets)

## Changes
- List of key changes

## Test plan
- [ ] Manual test steps or scenarios

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL to the user so they can see it.

---

### Step 5: Run Code Review

**This step is mandatory and must run after Step 4 (PR creation) — no exceptions.**
Any code review that happened during implementation (e.g. as part of a plan file's internal agent phases) does NOT count as this step. Even if a review was already done, this step must still run independently after the PR exists.

Tell Claude — in natural language — to run the orchestrator with the PR number:

> "Run the code-review-orchestrator for PR #<number>"

The orchestrator runs the full review automatically — no further prompting needed.

**What the orchestrator does (fully automatic):**

**Phase 1 — Review (parallel):**
- Detects which files changed: frontend, backend, or both
- Spawns `react-code-reviewer` if frontend files changed
- Spawns `backend-code-reviewer` if backend files changed
- Performs security review itself (OWASP, secrets, auth, CORS, injection)
- Each agent posts its own findings: a summary comment + inline line-level comments on the PR
- All agents run in parallel; Phase 2 does not start until all Phase 1 agents finish

**Phase 2 — Fix (parallel, after all reviews):**
- Each domain agent reads the full PR conversation
- Each fixes all issues in its domain (all severities)
- Fixes are skipped if they risk breaking other features; tests are run after each fix; failing tests revert that specific fix and leave it as a PR comment
- Each agent pushes its own fix commit
- Orchestrator does a verification pass on all fix commits

**Phase 3 — Final status:**
- Orchestrator posts a summary table: which agents ran, how many issues found, how many fixed, what was skipped
- Skipped fixes are listed for human resolution

**The human only needs to act if:**
- An ambiguous file is found (orchestrator will ask in chat — answer is cached for future PRs)
- A fix was skipped due to cross-cutting risk (left as a PR comment)

**Never commit fixes before posting review comments.** The GitHub comment trail must show findings first, then fixes.

---

### Step 6: Work is Done — Await Human Review

After the orchestrator finishes, the workflow is complete.

**Claude must never merge the feature branch into main.**
Only the human can approve and merge the PR. This is a hard rule.

---

## Summary

| Step | Who | Action |
|------|-----|--------|
| 0 | Claude | Determine purpose → ask if unclear → name and create branch |
| 1 | Claude | Create branch (feature/, fix/, refactor/, experiment/, chore/, docs/) |
| 2 | Claude | Implement the change |
| 3 | Claude | Commit with clear message |
| 4 | Claude | Push and create PR to main |
| 5 | `code-review-orchestrator` | Phase 1: parallel review (security + domain specialists) → Phase 2: parallel fixes + verification → Phase 3: final status table posted to PR |
| 6 | Human | Review PR and merge when satisfied |

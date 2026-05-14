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

### Step 5: Run Code Review Agent

**This step is mandatory and must run after Step 4 (PR creation) — no exceptions.**
Any code review that happened during implementation (e.g. as part of a plan file's internal agent phases) does NOT count as this step. Even if a review was already done, this step must still run independently after the PR exists.

The goal is that the human can see the entire review process directly on GitHub — review comments first, then a follow-up commit with the fixes. The sequence must always be:

1. Post review comments on the PR
2. Fix the issues
3. Push a fix commit

**Never commit fixes before posting the review comments.** The comments must appear on GitHub before the fix commit, so the human can see what was found and why it was fixed.

After the PR is created, run a Code Review agent on the feature branch changes. The agent must:

**5a. Review the diff** and evaluate:
- **Best practices** — idiomatic code, consistency with the existing codebase
- **Code efficiency** — unnecessary re-renders, N+1 queries, redundant operations
- **Security issues** — XSS, injection, exposed secrets, insecure defaults, OWASP Top 10
- **Code quality** — readability, naming, dead code, missing error handling at system boundaries

**5b. Post review comments on GitHub** using `gh pr review` — before making any fixes. Use `--comment` to post inline comments and a general summary. Every issue found must appear as a comment on the PR. If no issues are found, post a comment confirming the review passed.

```bash
gh pr review <PR-number> --comment --body "..."
```

**5c. Fix all issues found**, then push a fix commit on the feature branch:

```bash
git add <files>
git commit -m "$(cat <<'EOF'
fix: address code review findings

- <issue 1 and why it was fixed>
- <issue 2 and why it was fixed>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin <branch-name>
```

If there are no issues, skip the fix commit — but still post the passing review comment in 5b.

After the fix commit is pushed, the agent summarizes:
1. What issues were found and posted as review comments
2. What was fixed and committed

---

### Step 6: Work is Done — Await Human Review

After the code review agent finishes, the workflow is complete.

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
| 5a | Claude (agent) | Review diff — evaluate best practices, efficiency, security, quality |
| 5b | Claude (agent) | Post all findings as GitHub PR review comments (before any fixes) |
| 5c | Claude (agent) | Fix issues + push fix commit (or confirm passing if none found) |
| 6 | Human | Review PR and merge when satisfied |

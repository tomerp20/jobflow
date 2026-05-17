# /gitflow — Deterministic Git Workflow

**When to invoke this skill:** Any time the JobFlow CLAUDE.md workflow needs to run Steps 1, 3, 4, or 5 — branch creation, committing, pushing, PR creation, and triggering the code review. This is the single canonical mechanism for all git operations in this project. Trigger phrases include: "run the gitflow", "commit and open a PR", "ship this", "push and create a PR", "follow the workflow", or any instruction to execute the CLAUDE.md development workflow after implementation is done.

Executes the full JobFlow git workflow: detect → infer → confirm → run scripts → review.
**You call pre-written scripts with inferred values. You do not write git commands yourself.**

Scripts live at: `.claude/commands/gitflow/scripts/`
Make them executable on first use: `chmod +x .claude/commands/gitflow/scripts/*.sh`

---

## Phase 1 — Detect git state

Run the detect script and parse its output:

```bash
bash .claude/commands/gitflow/scripts/detect.sh
```

Parse the output lines:
- `GIT_ROOT=<path>` → where changes live (main repo or a worktree path)
- `BRANCH=<name>` → current branch at that location (or `DETACHED` in detached-HEAD state)
- `STATUS=<value>` → one of:
  - `changes_here` — dirty files in the current repo
  - `changes_in_worktree` — dirty files in exactly one worktree
  - `multiple_dirty` — dirty files in more than one location (followed by `DIRTY=<path>` lines)
  - `clean` — nothing to commit anywhere
- Remaining lines → dirty file list (`git status --short` format), or `DIRTY=<path>` lines when `multiple_dirty`

Handle each status:
- `clean` → tell the user "No uncommitted changes found." and stop.
- `multiple_dirty` → show the user the list of dirty locations and ask which one to ship. Re-run `detect.sh` from that location (or pass its path) before continuing. Do not guess.
- `DETACHED` branch → stop and ask the user how to proceed (likely needs a real branch first).

---

## Phase 2 — Infer values from conversation context

Derive these variables from what was just implemented in this conversation.
Do NOT ask the user for these — infer them:

Branch prefixes and commit types are **different** — use the right convention for each (both defined in CLAUDE.md):

| Variable | Convention | Values |
|---|---|---|
| `BRANCH_PREFIX` | CLAUDE.md branch rule | `feature/` `fix/` `refactor/` `experiment/` `chore/` `docs/` |
| `COMMIT_TYPE` | Conventional commits | `feat` `fix` `refactor` `style` `docs` `test` `chore` |

Mapping (most common cases):
- New feature → branch `feature/`, commit `feat:`
- Bug fix → branch `fix/`, commit `fix:`
- Refactor → branch `refactor/`, commit `refactor:`
- Config/deps → branch `chore/`, commit `chore:`
- Docs → branch `docs/`, commit `docs:`
- Experiment → branch `experiment/`, commit `chore:` or `refactor:`

| Variable | Rule |
|---|---|
| `BRANCH_NAME` | If `BRANCH` ≠ `main` → use detected `BRANCH`. If `BRANCH` = `main` → `<BRANCH_PREFIX><kebab-3-to-5-words>` e.g. `feature/drag-and-drop-cards` |
| `COMMIT_SUMMARY` | Imperative mood, ≤72 chars, no type prefix (e.g. `eliminate search typing lag`) |
| `COMMIT_BODY` | 2–4 bullet lines describing what changed and why |
| `PR_TITLE` | ≤70 chars (e.g. `Fix search typing lag with debounced re-renders`) |
| `PR_SUMMARY` | 1–3 bullets for the PR `## Summary` section |
| `PR_TEST_PLAN` | Checkbox list (`- [ ] step`) of manual test scenarios |
| `FILES_TO_STAGE` | The dirty files from Phase 1 — filter out any secrets, `.env`, or `CLAUDE.md` |

---

## Phase 3 — Dry-run display (STOP and wait for confirmation)

Print this block with all values filled in:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/gitflow DRY RUN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GIT ROOT:   <GIT_ROOT>
BRANCH:     <BRANCH_NAME>  [exists / will create from main]
TYPE:       <CHANGE_TYPE>
COMMIT:     <CHANGE_TYPE>: <COMMIT_SUMMARY>
BODY:       - <bullet 1>
            - <bullet 2>
FILES:
  + <file 1>
  + <file 2>
PR TITLE:   <PR_TITLE>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Proceed? y=run  n=abort  e=edit a value
```

**Do not run any write command until the user replies.**

- `y` → proceed to Phase 4
- `n` → abort, no changes made, tell the user nothing was run
- `e` → ask which field to change, update it, re-display the dry-run, wait again

---

## Phase 4 — Execute scripts in order (only after `y`)

Never skip a step. Never rearrange. If a script exits non-zero, STOP and report the error.

### 4a — Create branch (SKIP if BRANCH_NAME already exists, i.e. BRANCH ≠ main)

Before invoking, verify whether the branch already exists locally:

```bash
git -C "<GIT_ROOT>" show-ref --verify --quiet "refs/heads/<BRANCH_NAME>" \
  && echo EXISTS || echo MISSING
```

- `EXISTS` → skip 4a entirely; we are already on the branch.
- `MISSING` → run the create-branch script:

```bash
bash .claude/commands/gitflow/scripts/create-branch.sh "<BRANCH_NAME>"
```

`create-branch.sh` branches directly off `origin/main` without resetting local `main`, refuses reserved names (`main`, `master`, `HEAD`), and enforces the `<type>/<kebab-case>` convention from CLAUDE.md.

### 4b — Stage files

Quote each file path individually so paths with spaces are passed correctly:

```bash
bash .claude/commands/gitflow/scripts/stage.sh -C "<GIT_ROOT>" "<file 1>" "<file 2>" "<file N>"
```

`stage.sh` refuses `.`, `-A`, `--all`, and a deny-list of sensitive paths (`.env*`, `CLAUDE.md`, `*.pem`, `*.key`, `id_rsa*`, `secrets/`). If you see a deny-list error, drop the offending file from the staged set — never bypass it.

### 4c — Commit (pipe the body via heredoc)

```bash
bash .claude/commands/gitflow/scripts/commit.sh -C "<GIT_ROOT>" "<CHANGE_TYPE>" "<COMMIT_SUMMARY>" <<'BODY'
- <bullet 1>
- <bullet 2>
- <bullet 3>
BODY
```

### 4d — Push

```bash
bash .claude/commands/gitflow/scripts/push.sh -C "<GIT_ROOT>" "<BRANCH_NAME>"
```

### 4e — Create PR (pipe the body via heredoc)

```bash
bash .claude/commands/gitflow/scripts/create-pr.sh "<BRANCH_NAME>" "<PR_TITLE>" <<'BODY'
## Summary
<PR_SUMMARY bullets>

## Changes
<one-line description per changed file>

## Test plan
<PR_TEST_PLAN checkboxes>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
```

Capture the URL printed to stdout. Report it to the user.

### 4f — Trigger code review (MANDATORY — never skip even if not asked)

Extract the PR number from the URL (`.../pull/<N>` → `N`).

Say: "Running Step 5 — code-review-orchestrator for PR #<N>"

Then spawn the `code-review-orchestrator` agent for that PR number.

---

## Hard rules

- Never commit `CLAUDE.md`, `.env`, secrets, or files unrelated to the feature
- Never pass `.` or `-A` to `stage.sh` — always list explicit file paths
- Never use `--no-verify`, `--force`, or amend a pushed commit
- Never push directly to `main` or `master`
- Never merge — human only
- Step 4f always runs after a successful PR creation
- On any script failure: STOP, show the error output, do not continue

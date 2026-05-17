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

## Phase 4 — Delegate execution to git-ops agent (only after `y`)

**All script execution is handled by the `git-ops` agent (Haiku). Never run the scripts directly in the main session.**

Spawn the `git-ops` agent using the Agent tool with `subagent_type: "git-ops"` and `model: "haiku"`. Pass it the following prompt, with every `<placeholder>` filled in from the values inferred in Phase 2:

---

```
You are being invoked by the /gitflow skill to execute git operations.
Follow your "Gitflow Script Execution" section exactly.

GIT_ROOT: <GIT_ROOT>
BRANCH_NAME: <BRANCH_NAME>
CREATE_BRANCH: <true if BRANCH was 'main', false otherwise>
COMMIT_TYPE: <COMMIT_TYPE>
COMMIT_SUMMARY: <COMMIT_SUMMARY>
FILES_TO_STAGE: "<file1>" "<file2>" "<fileN>"

COMMIT_BODY:
- <bullet 1>
- <bullet 2>
- <bullet 3>

PR_TITLE: <PR_TITLE>

PR_SUMMARY:
- <summary bullet 1>
- <summary bullet 2>

PR_CHANGES:
- <file1>: <one-line description>
- <file2>: <one-line description>

PR_TEST_PLAN:
- [ ] <test step 1>
- [ ] <test step 2>

Return the PR URL when done.
```

---

Wait for the git-ops agent to return. It will print the PR URL.

### 4f — Trigger code review (MANDATORY — never skip even if not asked)

Extract the PR number from the URL returned by git-ops (`.../pull/<N>` → `N`).

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

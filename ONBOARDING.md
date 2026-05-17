# JobFlow — Claude Code Onboarding

## Project Stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript (Vite) — `frontend/` |
| Backend | Node.js + Express + TypeScript — `backend/` |
| Database | Neon PostgreSQL (connection pooler), migrations via Knex |
| Hosting | Render (free plan — spins down after 15 min inactivity) |
| GitHub | `tomerp20/jobflow` |

---

## Claude Code Workflow

Every code change follows a strict 6-step workflow defined in `CLAUDE.md`. The short version:

1. Create a typed branch (`feature/`, `fix/`, `refactor/`, `chore/`, etc.)
2. Implement the change
3. Commit with a structured message (`feat:`, `fix:`, etc.)
4. Push and open a PR to `main` — return the PR URL
5. Run the multi-agent code review orchestrator (parallel security + domain reviewers → auto-fix phase)
6. Stop — never merge; the human approves and merges

Use `/gitflow` to execute steps 1, 3, 4, and 5 atomically.

---

## Worktree Setup

Background agents work in isolated git worktrees (`.claude/worktrees/`). This project has two npm packages (`frontend/`, `backend/`) whose `node_modules` are not copied into the worktree — only source files are.

### Automatic symlinks (configured globally)

`~/.claude/settings.json` includes:

```json
"worktree": {
  "symlinkDirectories": [
    "node_modules",
    "frontend/node_modules",
    "backend/node_modules"
  ]
}
```

When a worktree is created, Claude Code automatically symlinks all three `node_modules` directories from the main checkout. Agents can run `npm run dev`, `npm run build`, etc. immediately without reinstalling.

### Fallback permission (no prompt)

Also in `~/.claude/settings.json`, `Bash(ln -s *)` and `Bash(ln -sf *)` are in the global allow list, so any agent that creates a symlink manually is never interrupted by a permission prompt.

---

## Knex Migrations

**Never use bare `npx knex`** — it fails because the project uses TypeScript. Always invoke via ts-node explicitly:

```bash
npx ts-node ./node_modules/.bin/knex migrate:latest --knexfile knexfile.ts
```

---

## E2E Tests

```bash
npm run test:e2e   # always use this — never start servers manually
```

The test database URL must be read inline from `.env.test`; shell variable inheritance is unreliable here.

---

## Browser / Playwright Verification

Always sign in before navigating to any protected route. Sessions start unauthenticated.

- Email: `tomerp20@gmail.com`
- Password: `12345678`

# Knowledge Base Learnings

Append-only log of what worked, what didn't, and what to adjust next time. One bullet per observation, dated. Newest at the top.

Use this when:
- A raw/ ingest required guesswork that a schema change would have prevented
- A wiki page format turned out to be unhelpful when re-read in a later session
- A wikilink convention created ambiguity
- Reciprocal linking was forgotten and caused dead-ends
- A page got stale because we didn't notice a code change

Each entry: **what happened → what we'd change**. Skip generic platitudes.

---

- **2026-05-25 — backfill missing-file tolerance (issue #255, PR #256).** A single ENOENT in a hour file tripped the per-date catch in ingester.js whose `break` then abandoned every later date. The first fix attempt distinguished ENOENT in worker.js so the main thread could skip-and-continue, but in monitored live testing it deadlocked the run instead: `fileStream.pipe(gunzip)` does NOT propagate read-side `error` events to the downstream stream by default, so an ENOENT on `createReadStream` bypasses the worker's own try/catch entirely and crashes the worker thread. The main thread's `worker.on('error')` then removes the worker from the pool; with consecutive missing dates, all 8 workers die and the main thread waits forever for messages that will never come. Final fix: pre-flight existence check at the **ingester** layer (date-dir check, then per-hour file check) before dispatching to workers — workers never see a missing file in normal operation. → Stream error propagation is non-obvious; prefer `stream.pipeline` over `.pipe()` when error handling matters, OR check existence before opening. Also: skip-semantics belong at whatever layer can express the contract cleanly (here, the ingester knows the full per-date hourId list and can filter once; the worker layer would have to do it per-file with messier accounting). The earlier framing 'belongs in the layer that knows about the disk' was directionally right but the **ingester** is more precisely the layer that owns the dispatch list — not the worker.

- **2026-05-24 — slice 4 ship (PR #249).** Edits made in the main working dir (on the wrong slice-3 branch) were copied to the worktree via `cp` before staging — the worktree isolation pattern means all Edit/Write calls must target the worktree path directly, not the main jobflow dir. → When shipping in a worktree context, always compute the absolute worktree path and pass it to Edit/Write from the start; don't rely on the main checkout.

## 2026-05-24 (PR #248 — Company Scout slice 3)

- **Anchor prefix sweep requires an explicit login-prefix filter after `searchOrgs`.** `searchOrgs("wix-")` returns any org whose name or login contains "wix-", not just those whose login literally starts with `wix-`. Always filter results with `login.toLowerCase().startsWith(anchor + "-")` before scoring — otherwise unrelated orgs that happen to contain the anchor substring get the W_ANCHOR_PREFIX_SIBLING bonus. This filter is in `orgResolver.ts:prefixResults.filter`.
- **`latestActivePush` is a natural companion to `hasActiveGitHubPresence` for the same single-pass.** The Classifier and the payload builder both need to scan the repo list; exporting `latestActivePush` (returns `string | null`) means the main orchestrator pays for one scan, not two, and the null return doubles as the "inactive" signal. → When a pure classifier and a data-extraction step share identical filtering logic, collapse them into a single function that returns data-or-null rather than two functions (boolean + extractor).

## 2026-05-24 (PR #247 — Company Scout slice 2)

- **OrgScorer calibration: exact-slug-only orgs naturally stay below threshold without threshold tuning.** Small/unknown orgs that happen to have an exact slug match (e.g. `faye`, `rise`) score only 50 (exact slug +50 but no credibility signals). Real anchor orgs score 85–120 because they have followers ≥100 (+10) and repos ≥5 (+10) plus display-name match. No weight adjustment was needed on first implementation — the ADR 0009 starting weights were correct. → Trust the rubric's credibility signals to do the disambiguation work; don't inflate the threshold to compensate for calibration failures you haven't yet measured.
- **Worktrees vs main checkout: write files into the right tree.** When a worktree exists at `.claude/worktrees/<name>`, edits to `/Users/itc/Desktop/jobflow/...` go into the main checkout (a different git working tree), not the worktree. Always verify which git working tree a path resolves to before writing implementation files; use the worktree's absolute path explicitly.
- **`git stash`+`stash pop` in the main checkout can silently switch that checkout's branch state** when background agents or stash operations touch it mid-session. The worktree is isolated from this, but writing files to the main checkout path while it's been stash-popped to a different branch creates confusion. Prefer writing to worktree paths directly and avoid touching the main checkout during a worktree-based ship.

## 2026-05-24 (PR #244 — Company Scout slice 1)

- **Global dedup in `createCard` must use the base `db` instance, not the caller's `trx`.** The First Sighting check queries `cards.company_name` globally across all users; using `runner` (which may be a `trx`) would scope the read to uncommitted rows inside the current transaction, making concurrent creates race past the dedup. → Always use `db` (not `runner`/`trx`) for reads that need committed global state even when the surrounding write uses a transaction.

## 2026-05-24 (PR #250 — Cassandra write shim)

- **Caddy beats nginx for a single-endpoint HTTPS shim with no existing infra dependency.** Caddy provisions and renews Let's Encrypt certs automatically; the Caddyfile for "one route, reverse-proxy to localhost" is ~15 lines vs ~40 for a minimal nginx block. When the choice is unconstrained, Caddy is lower ongoing ops burden. → Use Caddy as the default reverse-proxy for new services on the Linux box; document nginx only if a service joins existing nginx infra.
- **LWT `[applied]` column access in cassandra-driver:** the driver returns the LWT applied column as `rows[0]['[applied]']` (bracket notation, not `.applied`). Must access with bracket syntax or the value is undefined.

## 2026-05-24 (PR #242 — fetcher p-limit bump)

- **File size varies ~3× across different months of GH Archive.** Jan 2025 files averaged ~77 MB/hour vs ~25 MB for May 2026 — GitHub event volume grew significantly. When benchmarking fetcher throughput, files/sec is a misleading metric across different date ranges; MB/s is the correct comparison. The p-limit(3→6) bump yielded ~2.2× MB/s improvement (71 vs 33 MB/s) on the Xubuntu box, clearing the >1.3× approval threshold.

## 2026-05-24 (PR #241 — ingester worker-side decompression)

- **Main-thread readline is the silent bottleneck in Node.js streaming pipelines.** When the hot loop is `readline.on('line')` dispatching to workers via `postMessage`, the workers starve because the main thread can't feed them fast enough — even if libuv (gunzip) and the workers themselves are under capacity. The fix is to move the entire `createReadStream → createGunzip → createInterface` pipeline into each worker so each worker pulls directly from disk. → Before profiling worker starvation, check main-thread CPU utilization — if the main thread is hot while workers idle, the bottleneck is the dispatch loop, not the workers.

## 2026-05-24

- **`processed_files` schema change reveals that "No schema change" claims in ADRs age poorly.** ADR 0005 explicitly said "No schema change" and that claim became incorrect when issue #238 restructured the table. Future ADRs that make "no X" claims should include a "what would invalidate this" section so stale markers are easier to find. → Added superseded warning inline in [[adr-0005-processed-files-hourly-only]] rather than deleting it; linking pattern between ADRs is more durable than rewriting history.

## 2026-05-23

- **Wired the knowledge base into 8 daily skills/commands** so the patterns trigger without conscious effort: `grill-with-docs`, `write-a-prd`, `prd-to-issues`, `ship`, `gitflow`, `orchestrate-review`, `tdd`, `to-prd`. Each got a pre-load step (read `wiki/index.md` + grep), citation discipline (use `[[wikilinks]]` instead of re-explaining), and a capture step (save outputs to `raw/`, edit affected wiki pages, append learnings). `ship` and `gitflow` now have a mandatory "wiki update gate" between PR creation and code review — same shape as a tests-must-pass gate. `orchestrate-review` now instructs sub-agents to cite the `[[wikilink]]`/ADR being violated when flagging issues, and to post a "Knowledge-base proposals from this review" comment in Phase 3. → Couldn't wire `/verify` (not installed locally) or `/code-review` (plugin command — would be overwritten on plugin update). If those are wanted, the universal 4-line block from the earlier suggestion would have to be added by hand on each plugin upgrade.

- **Bootstrapped the knowledge base.** Schema in `CLAUDE.md`, flat `wiki/`, hook on `UserPromptSubmit` checking `raw/.processed.json`. Seeded with pointers to `CONTEXT.md`, `MEMORY.md`, ADRs, and CassandraPlan rather than duplicating them. → Next ingest will tell us whether the manifest+hook combo actually nudges processing, or whether it needs to be more aggressive.
- **Mistake: left ADR pages as unresolved wikilinks.** First bootstrap pass referenced ADRs in `index.md` as `[[adr-NNNN-...]]` but never created the mirror pages. The schema allows unresolved links, but the user expected `docs/` content to be *covered*, not just *pointed at*. → Next time, when seeding from a known-finite source (the `docs/` folder), enumerate everything in it first and create the wiki pages in the same pass — don't leave finite, known-good sources as TODOs.
- **Mistake: referenced the wrong CassandraPlan.** Initial seed pointed at `/CassandraPlan.md` (root, older v1) instead of `docs/CassandraPlan.md` (v2, canonical, supersedes v1). The v2 explicitly says `Supersedes: v1`. → When a file appears in two locations, read both headers before deciding which is canonical; don't assume the root copy wins.

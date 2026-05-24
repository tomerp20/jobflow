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

## 2026-05-24 (PR #241 — ingester worker-side decompression)

- **Main-thread readline is the silent bottleneck in Node.js streaming pipelines.** When the hot loop is `readline.on('line')` dispatching to workers via `postMessage`, the workers starve because the main thread can't feed them fast enough — even if libuv (gunzip) and the workers themselves are under capacity. The fix is to move the entire `createReadStream → createGunzip → createInterface` pipeline into each worker so each worker pulls directly from disk. → Before profiling worker starvation, check main-thread CPU utilization — if the main thread is hot while workers idle, the bottleneck is the dispatch loop, not the workers.

## 2026-05-24

- **`processed_files` schema change reveals that "No schema change" claims in ADRs age poorly.** ADR 0005 explicitly said "No schema change" and that claim became incorrect when issue #238 restructured the table. Future ADRs that make "no X" claims should include a "what would invalidate this" section so stale markers are easier to find. → Added superseded warning inline in [[adr-0005-processed-files-hourly-only]] rather than deleting it; linking pattern between ADRs is more durable than rewriting history.

## 2026-05-23

- **Wired the knowledge base into 8 daily skills/commands** so the patterns trigger without conscious effort: `grill-with-docs`, `write-a-prd`, `prd-to-issues`, `ship`, `gitflow`, `orchestrate-review`, `tdd`, `to-prd`. Each got a pre-load step (read `wiki/index.md` + grep), citation discipline (use `[[wikilinks]]` instead of re-explaining), and a capture step (save outputs to `raw/`, edit affected wiki pages, append learnings). `ship` and `gitflow` now have a mandatory "wiki update gate" between PR creation and code review — same shape as a tests-must-pass gate. `orchestrate-review` now instructs sub-agents to cite the `[[wikilink]]`/ADR being violated when flagging issues, and to post a "Knowledge-base proposals from this review" comment in Phase 3. → Couldn't wire `/verify` (not installed locally) or `/code-review` (plugin command — would be overwritten on plugin update). If those are wanted, the universal 4-line block from the earlier suggestion would have to be added by hand on each plugin upgrade.

- **Bootstrapped the knowledge base.** Schema in `CLAUDE.md`, flat `wiki/`, hook on `UserPromptSubmit` checking `raw/.processed.json`. Seeded with pointers to `CONTEXT.md`, `MEMORY.md`, ADRs, and CassandraPlan rather than duplicating them. → Next ingest will tell us whether the manifest+hook combo actually nudges processing, or whether it needs to be more aggressive.
- **Mistake: left ADR pages as unresolved wikilinks.** First bootstrap pass referenced ADRs in `index.md` as `[[adr-NNNN-...]]` but never created the mirror pages. The schema allows unresolved links, but the user expected `docs/` content to be *covered*, not just *pointed at*. → Next time, when seeding from a known-finite source (the `docs/` folder), enumerate everything in it first and create the wiki pages in the same pass — don't leave finite, known-good sources as TODOs.
- **Mistake: referenced the wrong CassandraPlan.** Initial seed pointed at `/CassandraPlan.md` (root, older v1) instead of `docs/CassandraPlan.md` (v2, canonical, supersedes v1). The v2 explicitly says `Supersedes: v1`. → When a file appears in two locations, read both headers before deciding which is canonical; don't assume the root copy wins.

# ADR 0001: Applied Stage flag mirrors Rejection Stage pattern

## Status
Proposed

## Context
The Email Agent needs a target Stage when auto-creating Applications from Application Receipts. Three options were considered:

1. Use the default Stage (`is_default = true`) — always available, but semantically wrong (the default is typically "Wishlist", not "Applied")
2. Name-based heuristic ("Applied") with fallback to default — works for most users but is brittle against renamed or non-English Stages
3. Add an `is_applied_stage` flag to the `stages` table, seeded to the "Applied" Stage at account setup — mirrors the existing `is_rejection_stage` pattern exactly

## Decision
Add `is_applied_stage` boolean flag to `stages`. Seed it to the "Applied" Stage at account creation (same mechanism used for `is_rejection_stage` on "Rejected"). The Email Agent reads this flag to find the placement target, identical to how it reads `is_rejection_stage` for rejections.

## Consequences
- Requires a migration to add the column and backfill existing users' "Applied" Stage
- Consistent with the existing Rejection Stage mental model — no new pattern to learn
- No UI to reassign the flag (same limitation as Rejection Stage — deferred)
- If a user has no Stage with `is_applied_stage = true` (e.g., deleted it), fall back to the default Stage and include that in the Notification

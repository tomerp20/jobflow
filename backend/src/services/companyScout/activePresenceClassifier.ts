import type { GitHubRepo } from './githubClient';

// Rolling window: a repo pushed within this many milliseconds of now is
// considered recently active.
const ACTIVE_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Active-Presence Classifier — pure function, no I/O.
 *
 * Returns true when the Org has at least one public, non-fork, non-archived
 * repository whose `pushed_at` timestamp falls within the last 365 days
 * (rolling from call time).
 *
 * An Org failing any of those conditions (all repos are forks/archived, or the
 * most recent push is stale, or the list is empty) returns false.
 */
export function hasActiveGitHubPresence(repos: GitHubRepo[]): boolean {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  return repos.some((repo) => {
    if (repo.fork) return false;
    if (repo.archived) return false;
    if (!repo.pushed_at) return false;
    return new Date(repo.pushed_at).getTime() >= cutoff;
  });
}

/**
 * For active Orgs, also return the most recent push date across qualifying
 * repos so the caller can build the `lastRepoPush` field without a second
 * scan.
 *
 * Returns null when the Org has no active presence (same condition as
 * `hasActiveGitHubPresence`).
 */
export function latestActivePush(repos: GitHubRepo[]): string | null {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  let latest: Date | null = null;

  for (const repo of repos) {
    if (repo.fork) continue;
    if (repo.archived) continue;
    if (!repo.pushed_at) continue;
    const pushed = new Date(repo.pushed_at);
    if (pushed.getTime() < cutoff) continue;
    if (!latest || pushed > latest) latest = pushed;
  }

  return latest ? latest.toISOString() : null;
}

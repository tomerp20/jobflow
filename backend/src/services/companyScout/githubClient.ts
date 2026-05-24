import { env } from '../../config/env';
import logger from '../../config/logger';

// Mirrors the 3 s timeout used for Clearbit in cardService.ts.
const REQUEST_TIMEOUT_MS = 3000;

export interface GitHubOrg {
  login: string;
  name: string | null;
  public_repos: number;
  followers: number;
  // Public repos listed by listOrgRepos; absent from getOrg/searchOrgs responses.
  repos?: GitHubRepo[];
}

export interface GitHubRepo {
  name: string;
  fork: boolean;
  archived: boolean;
  pushed_at: string | null;
}

export interface GitHubOrgSearchResult {
  login: string;
  // The search endpoint returns a stripped-down org object; name is not
  // included — callers that need it must follow up with getOrg().
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function githubFetch(url: string): Promise<Response | null> {
  // When GITHUB_TOKEN is absent, short-circuit immediately without making any
  // HTTP request.  The Scout's caller treats a null return as "Scout skipped".
  if (!env.GITHUB_TOKEN) {
    logger.warn('github_client.no_token', {
      service: 'company-scout',
      url,
      message: 'GITHUB_TOKEN not configured — GitHub API call skipped',
    });
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: authHeaders(),
      signal: controller.signal,
    });
    clearTimeout(timer);

    // Rate-limit detection: 403 + X-RateLimit-Remaining: 0
    if (
      res.status === 403 &&
      res.headers.get('X-RateLimit-Remaining') === '0'
    ) {
      logger.warn('github_client.rate_limited', {
        service: 'company-scout',
        url,
        reset: res.headers.get('X-RateLimit-Reset'),
      });
      return null;
    }

    return res;
  } catch (err: unknown) {
    clearTimeout(timer);
    // AbortError means the timeout fired; other errors are network failures.
    logger.warn('github_client.fetch_error', {
      service: 'company-scout',
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Fetch a single GitHub organization by login.
 * Returns null on missing token, rate-limit, HTTP error, or timeout.
 */
export async function getOrg(login: string): Promise<GitHubOrg | null> {
  const res = await githubFetch(`https://api.github.com/orgs/${encodeURIComponent(login)}`);
  if (!res) return null;
  if (!res.ok) return null;
  const data = await res.json() as {
    login: string;
    name: string | null;
    public_repos: number;
    followers: number;
  };
  return {
    login: data.login,
    name: data.name ?? null,
    public_repos: data.public_repos,
    followers: data.followers,
  };
}

/**
 * List public repositories for an org (up to 100, sorted by push date).
 * Returns null on missing token, rate-limit, HTTP error, or timeout.
 */
export async function listOrgRepos(login: string): Promise<GitHubRepo[] | null> {
  const url = `https://api.github.com/orgs/${encodeURIComponent(login)}/repos?type=public&sort=pushed&per_page=100`;
  const res = await githubFetch(url);
  if (!res) return null;
  if (!res.ok) return null;
  const data = await res.json() as {
    name: string;
    fork: boolean;
    archived: boolean;
    pushed_at: string | null;
  }[];
  return data.map((r) => ({
    name: r.name,
    fork: r.fork,
    archived: r.archived,
    pushed_at: r.pushed_at ?? null,
  }));
}

/**
 * Search GitHub organizations by query string.
 * Returns up to 30 results (GitHub's default page size for org search).
 * Returns null on missing token, rate-limit, HTTP error, or timeout.
 */
export async function searchOrgs(query: string): Promise<GitHubOrgSearchResult[] | null> {
  const url = `https://api.github.com/search/users?q=${encodeURIComponent(query)}+type:org&per_page=30`;
  const res = await githubFetch(url);
  if (!res) return null;
  if (!res.ok) return null;
  const data = await res.json() as { items: { login: string }[] };
  return (data.items ?? []).map((item) => ({ login: item.login }));
}

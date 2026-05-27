/**
 * OrgScorer — weighted rubric for deciding whether a GitHub Org is the
 * correct match for a Company name.
 *
 * All weights live here, in one place.  Tune them and the threshold
 * without touching any other file.
 *
 * See ADR 0009 for rationale.
 */

import { extractATSSlug } from '../cardService';

// --------------------------------------------------------------------------
// Weight constants — single editable place (ADR 0009)
// --------------------------------------------------------------------------

export const W_EXACT_SLUG            =  50; // normalize(company) === normalize(org.login)
export const W_STRONG_SLUG           =  30; // substring + length-ratio ≥ 0.7
export const W_MODERATE_SLUG         =  15; // substring + length-ratio ≥ 0.5
export const W_EXACT_DISPLAY_NAME    =  50; // normalize(company) === normalize(org.name)
export const W_MODERATE_DISPLAY_NAME =  15; // substring + length-ratio ≥ 0.5
export const W_ATS_SLUG_AGREES       =  40; // ATS slug extracted from URL matches org login
export const W_ATS_SLUG_DISAGREES    = -20; // [LOCAL TEST] softened from -50 — was too aggressive for ATS platforms that use full legal names (Perion → perionnetworkltd ≠ Perion). Clean win in Option-E re-run (gained Perion, lost nothing).
export const W_ANCHOR_PREFIX_SIBLING =  50; // org login starts with "<verified-anchor>-"
export const W_REAL_ORG_REPOS        =  10; // [REVERTED] back to 10 — boosting to 15 enabled prefix-sweep garbage (Salesforce-Kr1s-Dev, GeneSys-fatec, RISE-sait etc., all scoring exactly 80)
export const W_REAL_ORG_FOLLOWERS    =  10; // [REVERTED] back to 10 — same reason; paired with W_REAL_ORG_REPOS
export const W_VERIFIED_ORG          =  20; // [LOCAL TEST v2] org.is_verified === true — verified domain ownership. Recovers Tenable / large-corp anchors that lose on display-name-not-set; near-impossible to fake (paid feature).

/**
 * Acceptance threshold — single dial.
 *
 * Note: the search-fallback path applies an additional signal-based filter
 * (see orgResolver.ts Pass 2) — candidate must have is_verified=true OR an
 * exact slug match — instead of using a higher threshold. Per the Run-3
 * evidence (a higher SEARCH threshold lost 8 real companies to filter 3
 * false positives), threshold-based filtering on search was too blunt.
 */
export const ORG_ACCEPT_THRESHOLD = 80;

// --------------------------------------------------------------------------
// Candidate shape expected by the scorer
// --------------------------------------------------------------------------

export interface OrgCandidate {
  login: string;
  name: string | null;
  public_repos: number;
  followers: number;
  /** GitHub `is_verified` flag — verified domain ownership; see W_VERIFIED_ORG. */
  is_verified?: boolean;
  /** When present, non-fork count is used instead of public_repos for credibility scoring. */
  repos?: Array<{ fork: boolean; archived?: boolean }>;
  /**
   * When this candidate is being evaluated as an anchor-prefix sibling
   * (org login starts with "<verified-anchor>-"), provide the verified anchor
   * login here.  Absent ↔ not a sibling pass.
   */
  anchorLogin?: string;
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

/**
 * Normalize a string for slug comparison: lowercase, strip non-alphanumeric.
 * Matches the normalize pattern used elsewhere in cardService.ts.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Compute length-ratio: shorter / longer.  Returns 1 when the strings are
 * the same length.
 */
function lengthRatio(a: string, b: string): number {
  const min = Math.min(a.length, b.length);
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return min / max;
}

/**
 * True when `a` is a substring of `b` OR `b` is a substring of `a`.
 */
function isSubstring(a: string, b: string): boolean {
  return a.includes(b) || b.includes(a);
}

/**
 * Check whether any URL in the array looks like an ATS platform URL, and
 * return the ATS slug if found.  Returns null when no URL hits an ATS entry
 * that produces a slug.
 *
 * We re-use `extractATSSlug` from cardService to avoid duplicate logic.
 * Only non-null, non-empty slugs are returned.
 */
function atsSlugFromUrls(urls: string[]): string | null {
  for (const url of urls) {
    try {
      const slug = extractATSSlug(url);
      if (slug && slug.length > 0) return slug;
    } catch {
      // malformed URL — skip
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Public scoring function
// --------------------------------------------------------------------------

/**
 * Score a GitHub Org candidate against a Company name.
 *
 * @param company   The Company name as stored in JobFlow (e.g. "Wix").
 * @param candidate The GitHub Org object returned by the API client.
 * @param urls      Optional list of URLs from the Application (applicationUrl,
 *                  careersUrl).  Used to extract the ATS slug signal.
 * @returns         A numeric score.  Compare against ORG_ACCEPT_THRESHOLD.
 */
export function scoreOrgCandidate(
  company: string,
  candidate: OrgCandidate,
  urls?: string[],
): number {
  let score = 0;

  const normCompany = normalize(company);
  const normLogin   = normalize(candidate.login);

  // -----------------------------------------------------------------------
  // Slug signals
  // -----------------------------------------------------------------------

  if (normCompany === normLogin) {
    // Exact slug match — strongest positive signal
    score += W_EXACT_SLUG;
  } else {
    const ratio = lengthRatio(normCompany, normLogin);
    if (isSubstring(normCompany, normLogin) && ratio >= 0.7) {
      score += W_STRONG_SLUG;
    } else if (isSubstring(normCompany, normLogin) && ratio >= 0.5) {
      score += W_MODERATE_SLUG;
    }
    // Below 0.5 ratio → no slug contribution.
  }

  // -----------------------------------------------------------------------
  // Display-name signals
  // -----------------------------------------------------------------------

  if (candidate.name) {
    const normName = normalize(candidate.name);
    if (normCompany === normName) {
      score += W_EXACT_DISPLAY_NAME;
    } else {
      const ratio = lengthRatio(normCompany, normName);
      if (isSubstring(normCompany, normName) && ratio >= 0.5) {
        score += W_MODERATE_DISPLAY_NAME;
      }
    }
  }

  // -----------------------------------------------------------------------
  // ATS slug signal
  // -----------------------------------------------------------------------

  if (urls && urls.length > 0) {
    const atsSlug = atsSlugFromUrls(urls);
    if (atsSlug) {
      const normAts = normalize(atsSlug);
      if (normAts === normLogin) {
        score += W_ATS_SLUG_AGREES;
      } else {
        // ATS slug is present and points at a different org — genuine negative
        // evidence.  This is the only signal that subtracts from the score.
        score += W_ATS_SLUG_DISAGREES;
      }
    }
    // No ATS slug extractable from the URLs → no contribution either way.
  }

  // -----------------------------------------------------------------------
  // Anchor-prefix sibling signal
  // -----------------------------------------------------------------------

  // A verified anchor is the canonical Org for this Company (scored and
  // accepted in a prior pass).  Any Org whose login starts with
  // "<anchor>-" is presumed to be a subsidiary or sub-project org — accept
  // with full confidence.
  if (candidate.anchorLogin) {
    // login must literally start with "<anchor>-" (raw, not normalized, for
    // prefix matching to be meaningful as a real org-naming convention)
    if (candidate.login.toLowerCase().startsWith(candidate.anchorLogin.toLowerCase() + '-')) {
      score += W_ANCHOR_PREFIX_SIBLING;
    }
  }

  // -----------------------------------------------------------------------
  // Real-org credibility
  // -----------------------------------------------------------------------

  // Prefer non-fork repos when a repos list is available; fall back to
  // public_repos count (which includes forks) when it's not.
  if (candidate.repos !== undefined) {
    const nonForkCount = candidate.repos.filter((r) => !r.fork).length;
    if (nonForkCount >= 5) score += W_REAL_ORG_REPOS;
  } else if (candidate.public_repos >= 5) {
    // repos list not available — use the org-level count as a proxy
    score += W_REAL_ORG_REPOS;
  }

  if (candidate.followers >= 100) score += W_REAL_ORG_FOLLOWERS;

  // -----------------------------------------------------------------------
  // Verified-org signal — GitHub's is_verified flag (verified domain).
  // -----------------------------------------------------------------------
  //
  // Strong, near-unforgeable positive. Distinguishes corporate orgs that
  // proved domain ownership from "Salesforce-Kr1s-Dev"-style namesakes that
  // can never get this flag. Recovers anchors like Tenable (was 70 from
  // exact slug + credibility — 70+20 = 90 ≥ 80 threshold).

  if (candidate.is_verified) score += W_VERIFIED_ORG;

  return score;
}


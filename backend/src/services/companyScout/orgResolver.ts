/**
 * Org Resolver — given a Company name and optional Application URLs, returns
 * the list of accepted GitHub Org logins for that Company.
 *
 * Resolution pipeline (in order):
 *   1. Generate slug variants and probe each via getOrg.
 *   2. GitHub org-search fallback for the anchor using searchOrgs + getOrg.
 *   3. Score every candidate; accept those ≥ ORG_ACCEPT_THRESHOLD.
 *   4. Once the highest-scoring accepted Org becomes the anchor, prefix-sweep
 *      for "<anchor>-*" siblings via searchOrgs.
 *   5. Enforce the 20-Org safety cap — abort (return null) when exceeded.
 *
 * Returns the list of accepted OrgCandidate objects, or null when the 20-Org
 * cap is breached (caller must log and write nothing).
 */

import logger from '../../config/logger';
import { getOrg, searchOrgs, type GitHubOrg } from './githubClient';
import {
  scoreOrgCandidate,
  ORG_ACCEPT_THRESHOLD,
  type OrgCandidate,
} from './orgScorer';

// Safety cap: if more candidates than this pass the threshold the scorer is
// likely misfiring — abort rather than write a partial set.
export const ORG_SAFETY_CAP = 20;

export interface AcceptedOrg {
  login: string;
  score: number;
}

// --------------------------------------------------------------------------
// Slug-variant generation
// --------------------------------------------------------------------------

/**
 * Produce slug variants for a Company name to probe as GitHub org logins.
 * Deduplicates the list before returning.
 *
 * Strategy: lower-cased with different separator treatments.  We don't try to
 * guess every possible org name — that's what GitHub org search is for.
 */
function slugVariants(company: string): string[] {
  const base = company.trim();
  const lower = base.toLowerCase();

  const variants = new Set<string>();

  // Plain lowercase — e.g. "Wix" → "wix"
  variants.add(lower);

  // Hyphens replacing spaces and common punctuation — e.g. "New Relic" → "new-relic"
  variants.add(lower.replace(/[\s_,.&]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''));

  // Strip all non-alphanumeric — e.g. "New Relic" → "newrelic"
  variants.add(lower.replace(/[^a-z0-9]/g, ''));

  // Replace " Inc", " Ltd", " Corp", " LLC" suffix variants (common in company names)
  const suffixStripped = lower
    .replace(/\s+(inc\.?|ltd\.?|corp\.?|llc\.?|co\.?|group|technologies|tech|labs?|software|systems?)$/i, '')
    .trim();
  if (suffixStripped !== lower) {
    variants.add(suffixStripped);
    variants.add(suffixStripped.replace(/[\s_,.&]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''));
    variants.add(suffixStripped.replace(/[^a-z0-9]/g, ''));
  }

  // Remove empty strings
  variants.delete('');

  return [...variants];
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Convert a GitHubOrg (from getOrg) to an OrgCandidate for scoring.
 */
function toCandidate(org: GitHubOrg, anchorLogin?: string): OrgCandidate {
  return {
    login: org.login,
    name: org.name,
    public_repos: org.public_repos,
    followers: org.followers,
    anchorLogin,
  };
}

// --------------------------------------------------------------------------
// Resolver
// --------------------------------------------------------------------------

export async function resolveOrgs(
  company: string,
  urls?: { applicationUrl?: string; careersUrl?: string },
): Promise<AcceptedOrg[] | null> {
  const urlList = [urls?.applicationUrl, urls?.careersUrl].filter(Boolean) as string[];

  // Track probed logins to avoid double-fetching
  const probed = new Set<string>();

  // Candidates that passed the threshold, in insertion order
  const accepted: AcceptedOrg[] = [];

  // -------------------------------------------------------------------------
  // Pass 1 — slug probing
  // -------------------------------------------------------------------------

  const variants = slugVariants(company);

  for (const slug of variants) {
    if (probed.has(slug)) continue;
    probed.add(slug);

    const org = await getOrg(slug);
    if (!org) continue; // 404, rate-limit, or timeout — skip

    const candidate = toCandidate(org);
    const score = scoreOrgCandidate(company, candidate, urlList);

    logger.debug('company_scout.resolver.slug_probe', {
      service: 'company-scout',
      company,
      slug,
      login: org.login,
      score,
      accepted: score >= ORG_ACCEPT_THRESHOLD,
    });

    if (score >= ORG_ACCEPT_THRESHOLD) {
      accepted.push({ login: org.login, score });
    }
  }

  // -------------------------------------------------------------------------
  // Pass 2 — GitHub org-search fallback for the anchor
  //
  // Only run search when we have not yet found any accepted Org (no anchor).
  // Search returns logins only; we must follow up with getOrg to score them.
  // -------------------------------------------------------------------------

  if (accepted.length === 0) {
    const searchResults = await searchOrgs(company);

    if (searchResults) {
      for (const result of searchResults) {
        if (probed.has(result.login)) continue;
        probed.add(result.login);

        const org = await getOrg(result.login);
        if (!org) continue;

        const candidate = toCandidate(org);
        const score = scoreOrgCandidate(company, candidate, urlList);

        logger.debug('company_scout.resolver.search_probe', {
          service: 'company-scout',
          company,
          login: org.login,
          score,
          accepted: score >= ORG_ACCEPT_THRESHOLD,
        });

        if (score >= ORG_ACCEPT_THRESHOLD) {
          accepted.push({ login: org.login, score });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Determine anchor — highest-scoring accepted Org so far.
  // -------------------------------------------------------------------------

  if (accepted.length === 0) {
    // No anchor found — nothing to sweep
    logger.info('company_scout.resolver.no_anchor', {
      service: 'company-scout',
      company,
    });
    return accepted;
  }

  const anchor = accepted.reduce((best, candidate) =>
    candidate.score > best.score ? candidate : best,
  );

  // -------------------------------------------------------------------------
  // Pass 3 — Anchor prefix sweep for "<anchor>-*" siblings
  // -------------------------------------------------------------------------

  const prefixQuery = `${anchor.login}-`;
  const prefixResults = await searchOrgs(prefixQuery);

  if (prefixResults) {
    for (const result of prefixResults) {
      // Only genuine "<anchor>-*" logins, not the anchor itself
      if (!result.login.toLowerCase().startsWith(anchor.login.toLowerCase() + '-')) continue;
      if (probed.has(result.login)) continue;
      probed.add(result.login);

      const org = await getOrg(result.login);
      if (!org) continue;

      // Score with anchorLogin set so W_ANCHOR_PREFIX_SIBLING fires
      const candidate = toCandidate(org, anchor.login);
      const score = scoreOrgCandidate(company, candidate, urlList);

      logger.debug('company_scout.resolver.prefix_sweep', {
        service: 'company-scout',
        company,
        anchor: anchor.login,
        login: org.login,
        score,
        accepted: score >= ORG_ACCEPT_THRESHOLD,
      });

      if (score >= ORG_ACCEPT_THRESHOLD) {
        accepted.push({ login: org.login, score });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Safety cap check
  // -------------------------------------------------------------------------

  if (accepted.length > ORG_SAFETY_CAP) {
    logger.error('company_scout.resolver.safety_cap_exceeded', {
      service: 'company-scout',
      company,
      accepted_count: accepted.length,
      cap: ORG_SAFETY_CAP,
      message:
        'More than 20 Orgs passed the acceptance threshold — possible scorer miscalibration; aborting this Company without writing any Orgs.',
    });
    return null; // Caller must treat null as "abort, write nothing"
  }

  logger.info('company_scout.resolver.resolved', {
    service: 'company-scout',
    company,
    accepted_count: accepted.length,
    accepted_orgs: accepted.map((o) => o.login),
  });

  return accepted;
}

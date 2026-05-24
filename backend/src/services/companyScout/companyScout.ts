import logger from '../../config/logger';
import { resolveRegistry, type CompanyRegistry } from './companyRegistry';
import { resolveOrgs } from './orgResolver';
import { listOrgRepos } from './githubClient';
import { latestActivePush } from './activePresenceClassifier';

// The registry singleton is resolved once at module load time.
// HttpShimCompanyRegistry is used when COMPANY_REGISTRY_URL is set (production);
// LoggingCompanyRegistry is the dev fallback (COMPANY_REGISTRY_URL unset).
const registry: CompanyRegistry = resolveRegistry();

/**
 * Runs the Company Scout for a Company on its First Sighting.
 *
 * Full end-to-end flow (slice #183):
 *   1. Org Resolver → accepted candidate Orgs (slug probe + search + prefix sweep).
 *   2. For each accepted Org: listOrgRepos → Active-Presence Classifier.
 *   3. Keep only Orgs with Active GitHub Presence.
 *   4. Build the activeOrgs payload and hand off to CompanyRegistry.register.
 *
 * In production (COMPANY_REGISTRY_URL set) the registry is HttpShimCompanyRegistry
 * which returns real `registered` / `already_exists` statuses from the shim.
 * In dev (URL unset) LoggingCompanyRegistry is the fallback.
 *
 * ---
 * ACCEPTED EDGE CASE — gmailSync transaction-boundary race:
 *
 * `createCard` is called inside gmailSync's per-email transaction; this
 * function is fired detached (not awaited) immediately after the INSERT
 * returns but before that transaction has committed. On a rare rollback
 * (e.g. the subsequent processed_emails audit INSERT fails), the card that
 * triggered the First Sighting no longer exists — but the Scout has already
 * run and may have written a `companies` row via the shim.
 *
 * This is intentionally accepted:
 *   - The shim's `INSERT … IF NOT EXISTS` makes duplicate sends safe
 *     (ADR 0010), and a stray `companies` row whose card vanished causes no
 *     correctness harm — the Backfill will attempt GitHub resolution for a
 *     company that happens to have no live card, producing at worst a low-
 *     value analytics row.
 *   - The alternative — awaiting inside the transaction, or adding a
 *     post-commit hook — would couple Scout latency to card-creation latency
 *     or require a more complex transaction API. Both costs outweigh the
 *     rare-rollback risk.
 *   - See also: knowledge/wiki/company-scout.md § "Surprises / gotchas"
 */
export async function runCompanyCheck(
  companyName: string,
  cardUrls?: { applicationUrl?: string; careersUrl?: string },
): Promise<void> {
  logger.info('company_scout.first_sighting', {
    service: 'company-scout',
    company: companyName,
    card_urls: cardUrls,
  });

  try {
    // ------------------------------------------------------------------
    // Step 1 — Resolve accepted candidate Orgs
    // ------------------------------------------------------------------

    const acceptedOrgs = await resolveOrgs(companyName, cardUrls);

    if (acceptedOrgs === null) {
      // Safety cap exceeded — resolver already logged the error; write nothing.
      return;
    }

    if (acceptedOrgs.length === 0) {
      logger.info('company_scout.no_orgs_found', {
        service: 'company-scout',
        company: companyName,
      });
      return;
    }

    // ------------------------------------------------------------------
    // Step 2 — Classify each accepted Org; keep only active ones
    // ------------------------------------------------------------------

    const activeOrgs: Array<{ org_name: string; last_repo_push: string }> = [];

    for (const accepted of acceptedOrgs) {
      const repos = await listOrgRepos(accepted.login);

      if (repos === null) {
        // Rate-limit / timeout / network error — skip this Org but continue
        // processing the rest.  Errors are already logged inside githubClient.
        logger.warn('company_scout.repos_unavailable', {
          service: 'company-scout',
          company: companyName,
          org: accepted.login,
        });
        continue;
      }

      const lastPush = latestActivePush(repos);

      if (lastPush === null) {
        // Org has no active public non-fork repos — classifier rejects it.
        logger.info('company_scout.org_inactive', {
          service: 'company-scout',
          company: companyName,
          org: accepted.login,
        });
        continue;
      }

      // Org passes the Active-Presence Classifier.
      logger.info('company_scout.org_active', {
        service: 'company-scout',
        company: companyName,
        org: accepted.login,
        last_repo_push: lastPush,
      });

      activeOrgs.push({ org_name: accepted.login, last_repo_push: lastPush });
    }

    // ------------------------------------------------------------------
    // Step 3 — Hand off to registry (HttpShimCompanyRegistry in production;
    //           LoggingCompanyRegistry when COMPANY_REGISTRY_URL is unset)
    // ------------------------------------------------------------------

    await registry.register(companyName, activeOrgs);
  } catch (err: unknown) {
    // Errors from the GitHub API / resolver / classifier must never surface
    // to the caller — card creation is fire-and-forget.
    logger.error('company_scout.error', {
      service: 'company-scout',
      company: companyName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

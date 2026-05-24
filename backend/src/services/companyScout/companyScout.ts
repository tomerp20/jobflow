import logger from '../../config/logger';
import { LoggingCompanyRegistry, type CompanyRegistry } from './companyRegistry';

// The registry singleton is resolved once at module load time.
// HttpShimCompanyRegistry (slice #184) will be swapped in here when
// COMPANY_REGISTRY_URL is configured; for now LoggingCompanyRegistry is the
// only implementation.
const registry: CompanyRegistry = new LoggingCompanyRegistry();

/**
 * Runs the Company Scout for a Company on its First Sighting.
 *
 * Slice 1 skeleton: logs the First Sighting and delegates to the registry
 * with an empty activeOrgs array (placeholder — GitHub resolution lands in
 * slice #182 / #183). HttpShimCompanyRegistry is deferred to slice #184.
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

  await registry.register(companyName, []);
}

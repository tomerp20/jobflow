import logger from '../../config/logger';
import { env } from '../../config/env';

export interface ActiveOrg {
  org_name: string;
  last_repo_push: string;
}

export interface CompanyRegistry {
  register(company: string, activeOrgs: ActiveOrg[]): Promise<void>;
}

/**
 * Dev fallback used when COMPANY_REGISTRY_URL is not configured. Logs a
 * structured line describing what would have been POSTed to the HTTPS shim.
 * HttpShimCompanyRegistry is the production implementation.
 */
export class LoggingCompanyRegistry implements CompanyRegistry {
  register(company: string, activeOrgs: ActiveOrg[]): Promise<void> {
    logger.info('company_registry.would_register', {
      service: 'company-scout',
      company,
      active_org_count: activeOrgs.length,
      active_orgs: activeOrgs,
    });
    return Promise.resolve();
  }
}

interface ShimResult {
  org_name: string;
  status: 'registered' | 'already_exists';
}

interface ShimResponse {
  company: string;
  results: ShimResult[];
}

/**
 * Production implementation — POSTs one batch per Company to the HTTPS shim
 * running alongside Cassandra on the analytics-pipeline host. See ADR 0010.
 *
 * Fire-and-forget: network errors, 4xx, and 5xx are caught and logged at
 * warn; they never propagate so card creation latency is unaffected.
 */
export class HttpShimCompanyRegistry implements CompanyRegistry {
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  async register(company: string, activeOrgs: ActiveOrg[]): Promise<void> {
    // ----- [LOCAL TEST DRY-RUN] -----------------------------------------
    // Bypass the HTTPS shim entirely and append each register() call to a
    // JSONL file at the repo root. Lets us evaluate a new scoring config
    // against the full backfill without touching Cassandra.
    //
    // Reverse: `git checkout backend/src/services/companyScout/companyRegistry.ts`
    {
      const { appendFile } = await import('node:fs/promises');
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        company,
        active_org_count: activeOrgs.length,
        active_orgs: activeOrgs,
      }) + '\n';
      try {
        await appendFile('/Users/itc/Desktop/jobflow/backfill-dry-run.jsonl', line);
        for (const o of activeOrgs) {
          logger.info('company_registry.dry_run_registered', {
            service: 'company-scout',
            company,
            org: o.org_name,
            last_repo_push: o.last_repo_push,
          });
        }
      } catch (err: unknown) {
        logger.warn('company_registry.dry_run_write_failed', {
          service: 'company-scout',
          company,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    // ----- end DRY-RUN ---------------------------------------------------

    // eslint-disable-next-line @typescript-eslint/no-unreachable-code
    const controller = new AbortController();
    // Mirror the 3 s Clearbit timeout used elsewhere in the backend.
    const timer = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${this.url}/companies`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company,
          active_orgs: activeOrgs,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        logger.warn('company_registry.http_error', {
          service: 'company-scout',
          company,
          status: res.status,
        });
        return;
      }

      const data = (await res.json()) as ShimResponse;

      for (const result of data.results) {
        if (result.status === 'registered') {
          const org = activeOrgs.find((o) => o.org_name === result.org_name);
          logger.info('company_registry.registered', {
            service: 'company-scout',
            company,
            org: result.org_name,
            last_repo_push: org?.last_repo_push ?? null,
          });
        } else if (result.status === 'already_exists') {
          logger.info('company_registry.already_exists', {
            service: 'company-scout',
            company,
            org: result.org_name,
          });
        }
      }
    } catch (err: unknown) {
      clearTimeout(timer);
      logger.warn('company_registry.network_error', {
        service: 'company-scout',
        company,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Resolve which CompanyRegistry implementation to use at startup:
 * - COMPANY_REGISTRY_URL set → HttpShimCompanyRegistry (production)
 * - COMPANY_REGISTRY_URL unset → LoggingCompanyRegistry (dev fallback)
 */
export function resolveRegistry(): CompanyRegistry {
  if (env.COMPANY_REGISTRY_URL) {
    return new HttpShimCompanyRegistry(
      env.COMPANY_REGISTRY_URL,
      env.COMPANY_REGISTRY_TOKEN ?? '',
    );
  }
  return new LoggingCompanyRegistry();
}

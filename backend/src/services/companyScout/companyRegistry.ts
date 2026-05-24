import logger from '../../config/logger';

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
 * HttpShimCompanyRegistry (slice #184) is the production implementation.
 */
export class LoggingCompanyRegistry implements CompanyRegistry {
  async register(company: string, activeOrgs: ActiveOrg[]): Promise<void> {
    logger.info('company_registry.would_register', {
      service: 'company-scout',
      company,
      active_org_count: activeOrgs.length,
      active_orgs: activeOrgs,
    });
  }
}

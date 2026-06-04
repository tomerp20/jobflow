import logger from '../../config/logger';
import { env } from '../../config/env';

/**
 * WhatsApp Notifier (ADR 0011). Sends an outbound WhatsApp Message on every
 * Application creation by POSTing { company, role, url } to the shim's /notify
 * route. The recipient and wording live shim-side — JobFlow only supplies the
 * three data fields.
 *
 * Mirrors the CompanyRegistry pattern: an interface with a production HTTP
 * implementation and a logging dev fallback, fire-and-forget so card-creation
 * latency is never affected.
 */
export interface ApplicationDetails {
  company: string;
  role: string;
  url?: string | null;
}

export interface WhatsAppNotifier {
  notify(details: ApplicationDetails): Promise<void>;
}

/**
 * Dev fallback used when WHATSAPP_NOTIFY_URL is not configured. Logs a
 * structured line describing what would have been sent — so local dev and
 * tests never message anyone.
 */
export class LoggingWhatsAppNotifier implements WhatsAppNotifier {
  notify(details: ApplicationDetails): Promise<void> {
    logger.info('whatsapp_notifier.would_notify', {
      service: 'whatsapp-notifier',
      company: details.company,
      role: details.role,
      url: details.url ?? null,
    });
    return Promise.resolve();
  }
}

/**
 * Production implementation — POSTs to the shim's /notify route running
 * alongside Cassandra on the analytics-pipeline host. See ADR 0011.
 *
 * Fire-and-forget: network errors, 4xx, and 5xx are caught and logged at warn;
 * they never propagate so card creation latency is unaffected.
 */
export class HttpShimWhatsAppNotifier implements WhatsAppNotifier {
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  async notify(details: ApplicationDetails): Promise<void> {
    const controller = new AbortController();
    // Mirror the 3 s timeout used by the Company Scout registry.
    const timer = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${this.url}/notify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company: details.company,
          role: details.role,
          url: details.url ?? undefined,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        logger.warn('whatsapp_notifier.http_error', {
          service: 'whatsapp-notifier',
          company: details.company,
          status: res.status,
        });
        return;
      }

      logger.info('whatsapp_notifier.queued', {
        service: 'whatsapp-notifier',
        company: details.company,
        role: details.role,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      logger.warn('whatsapp_notifier.network_error', {
        service: 'whatsapp-notifier',
        company: details.company,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

let cached: WhatsAppNotifier | null = null;

/**
 * Resolve which WhatsAppNotifier implementation to use:
 * - WHATSAPP_NOTIFY_URL set → HttpShimWhatsAppNotifier (production), reusing
 *   COMPANY_REGISTRY_TOKEN as the shared shim bearer token
 * - WHATSAPP_NOTIFY_URL unset → LoggingWhatsAppNotifier (dev fallback / no-op)
 */
export function resolveWhatsAppNotifier(): WhatsAppNotifier {
  if (cached) return cached;
  cached = env.WHATSAPP_NOTIFY_URL
    ? new HttpShimWhatsAppNotifier(env.WHATSAPP_NOTIFY_URL, env.COMPANY_REGISTRY_TOKEN ?? '')
    : new LoggingWhatsAppNotifier();
  return cached;
}

/**
 * Fire-and-forget entry point for the createCard call site. Never throws —
 * notifier errors must never fail card creation.
 */
export function notifyApplicationCreated(details: ApplicationDetails): void {
  resolveWhatsAppNotifier()
    .notify(details)
    .catch(() => {
      /* intentionally suppressed — notifier errors must not fail card creation */
    });
}

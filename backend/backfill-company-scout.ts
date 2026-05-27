/**
 * One-time backfill of the Company Scout against all existing cards.
 *
 * Untracked / not committed — see knowledge/learnings.md if you need to re-run.
 *
 * Behaviour:
 *   - Selects distinct Company names from the `cards` table (case-insensitive,
 *     whitespace-trimmed), ordered by the earliest card_id ASC.
 *   - For each, invokes `runCompanyCheck(companyName, { applicationUrl,
 *     careersUrl })` — the same code path the live Scout uses.
 *   - 500 ms pause between companies (politeness; well under the authenticated
 *     5 000/hr GitHub budget either way).
 *   - Idempotency lives in the shim (`INSERT … IF NOT EXISTS`), so re-running
 *     is harmless and recovery from a mid-run failure is "just run it again."
 *   - Writes a JSON summary to <repo-root>/backfill-company-scout-results.json
 *
 * Required env:
 *   DATABASE_URL              (auto-loaded from backend/.env via dotenv)
 *   JWT_SECRET                (auto-loaded from backend/.env via dotenv)
 *   GITHUB_TOKEN              (must be set inline for the run)
 *   COMPANY_REGISTRY_URL      (must be set inline for the run — without it,
 *                              the registry falls back to LoggingCompanyRegistry
 *                              and writes nothing to Cassandra)
 *   COMPANY_REGISTRY_TOKEN    (must be set inline for the run)
 */

import 'dotenv/config';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import db from './src/config/database';
import { runCompanyCheck } from './src/services/companyScout/companyScout';

interface CompanyRow {
  company_name: string;
  application_url: string | null;
  careers_url: string | null;
  min_id: string;
}

interface PerCompanyResult {
  company: string;
  outcome: 'ok' | 'error';
  error?: string;
  duration_ms: number;
}

async function main(): Promise<void> {
  // One row per normalized Company. company_name is the form on the
  // earliest card (kept for human-readable logs); URLs are taken from the
  // most-recent card that has them. Order by earliest card_id ASC per the
  // operator's instruction.
  const rows = (await db.raw(
    `
    WITH ranked AS (
      SELECT
        id,
        company_name,
        application_url,
        careers_url,
        created_at,
        LOWER(TRIM(company_name)) AS norm,
        MIN(id::text) OVER (PARTITION BY LOWER(TRIM(company_name))) AS min_id_for_norm
      FROM cards
    )
    SELECT
      MIN(min_id_for_norm)                                                AS min_id,
      (ARRAY_AGG(company_name ORDER BY created_at ASC))[1]               AS company_name,
      (ARRAY_AGG(application_url ORDER BY created_at DESC)
         FILTER (WHERE application_url IS NOT NULL))[1]                  AS application_url,
      (ARRAY_AGG(careers_url ORDER BY created_at DESC)
         FILTER (WHERE careers_url IS NOT NULL))[1]                      AS careers_url
    FROM ranked
    GROUP BY norm
    ORDER BY min_id ASC
    `,
  )).rows as CompanyRow[];

  // eslint-disable-next-line no-console
  console.log(`Backfilling ${rows.length} distinct companies (ordered by earliest card_id ASC, 500 ms pacing).`);

  const results: PerCompanyResult[] = [];
  const startedAt = new Date();

  for (let i = 0; i < rows.length; i++) {
    const { company_name, application_url, careers_url } = rows[i];
    const t0 = Date.now();
    // eslint-disable-next-line no-console
    console.log(`[${i + 1}/${rows.length}] ${company_name}`);

    try {
      await runCompanyCheck(company_name, {
        applicationUrl: application_url ?? undefined,
        careersUrl: careers_url ?? undefined,
      });
      results.push({ company: company_name, outcome: 'ok', duration_ms: Date.now() - t0 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ company: company_name, outcome: 'error', error: message, duration_ms: Date.now() - t0 });
      // eslint-disable-next-line no-console
      console.error(`  ERROR: ${message}`);
    }

    if (i < rows.length - 1) {
      await sleep(500);
    }
  }

  const finishedAt = new Date();
  const summary = {
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    processed: results.length,
    ok: results.filter((r) => r.outcome === 'ok').length,
    errors: results.filter((r) => r.outcome === 'error').length,
    per_company: results,
  };

  // Write the report to the repo root (one level up from backend/).
  const outPath = resolve(__dirname, '..', 'backfill-company-scout-results.json');
  writeFileSync(outPath, JSON.stringify(summary, null, 2));

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`Done.`);
  // eslint-disable-next-line no-console
  console.log(`  processed: ${summary.processed}`);
  // eslint-disable-next-line no-console
  console.log(`  ok: ${summary.ok}   errors: ${summary.errors}`);
  // eslint-disable-next-line no-console
  console.log(`  duration: ${(summary.duration_ms / 1000).toFixed(1)} s`);
  // eslint-disable-next-line no-console
  console.log(`  report: ${outPath}`);

  await db.destroy();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

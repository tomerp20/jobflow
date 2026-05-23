import cassandra from 'cassandra-driver';

const { types } = cassandra;
const BUCKET = 'singleton';

export async function findLatestRun(client, keyspace) {
  const result = await client.execute(
    `SELECT run_id, status, target_rows FROM ${keyspace}.backfill_runs WHERE bucket = ? ORDER BY run_id DESC LIMIT 1`,
    [BUCKET],
    { prepare: true }
  );
  if (result.rowLength === 0) return null;
  const row = result.rows[0];
  // Guard against a row with a missing/empty target_rows column. Without this,
  // the resume path would spawn the Ingester with `--target-companies ""`.
  if (!row.target_rows || row.target_rows.length === 0) {
    throw new Error(`backfill_runs row ${row.run_id} has no target_rows — cannot resume`);
  }
  const targetRows = row.target_rows.map(t => ({
    company: t.get(0),
    org_name: t.get(1),
  }));
  return { runId: row.run_id, status: row.status, targetRows };
}

export async function createNewRun(client, keyspace, uninitialised) {
  const runId = types.TimeUuid.now();
  const targetRows = uninitialised.map(r => new types.Tuple(r.company, r.org_name));
  await client.execute(
    `INSERT INTO ${keyspace}.backfill_runs (bucket, run_id, status, started_at, target_rows) VALUES (?, ?, 'in_progress', ?, ?)`,
    [BUCKET, runId, new Date(), targetRows],
    { prepare: true }
  );
  return { runId, targetRows: uninitialised };
}

export async function markCompleted(client, keyspace, runId, targetRows) {
  const now = new Date();
  // The per-company UPDATEs are idempotent (initialized=true is a fixed value),
  // so they are issued individually rather than in a multi-partition LOGGED
  // BATCH — the coordinator pressure and batch-size limit make a single LOGGED
  // BATCH across many partitions an anti-pattern. If any company UPDATE fails
  // here, the backfill_runs row stays in_progress; the resume-path short-circuit
  // on the next nightly run will retry markCompleted (also idempotent).
  const companyUpdate = `UPDATE ${keyspace}.companies SET initialized = true, initialized_at = ? WHERE company = ? AND org_name = ?`;
  for (const r of targetRows) {
    await client.execute(companyUpdate, [now, r.company, r.org_name], { prepare: true });
  }
  await client.execute(
    `UPDATE ${keyspace}.backfill_runs SET status = 'completed', completed_at = ? WHERE bucket = ? AND run_id = ?`,
    [now, BUCKET, runId],
    { prepare: true }
  );
}

export async function markFailed(client, keyspace, runId) {
  await client.execute(
    `UPDATE ${keyspace}.backfill_runs SET status = 'failed', completed_at = ? WHERE bucket = ? AND run_id = ?`,
    [new Date(), BUCKET, runId],
    { prepare: true }
  );
}

export async function getMaxCompletedDate(client, keyspace, runId) {
  const result = await client.execute(
    `SELECT date FROM ${keyspace}.backfill_progress WHERE run_id = ? ORDER BY date DESC LIMIT 1`,
    [runId],
    { prepare: true }
  );
  if (result.rowLength === 0) return null;
  return result.rows[0].date.toString(); // LocalDate → YYYY-MM-DD
}

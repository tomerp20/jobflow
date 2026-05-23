import cassandra from 'cassandra-driver';
import pLimit from 'p-limit';

const { Client, types, errors, policies } = cassandra;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [100, 500, 2000];
const BATCH_ROW_LIMIT = 50;
const BATCH_BYTE_LIMIT = 5 * 1024; // 5 KB

// Cassandra response error codes that are transient and safe to retry
const RETRYABLE_CODES = new Set([
  0x1000, // UnavailableException
  0x1001, // IsBootstrapping / Overloaded
  0x1100, // WriteTimeout
  0x1200, // ReadTimeout
]);

function isRetryable(err) {
  if (err instanceof errors.OperationTimedOutError) return true;
  if (err instanceof errors.ResponseError) return RETRYABLE_CODES.has(err.code);
  return false;
}

export class CassandraWriter {
  constructor({ contactPoints, localDc, keyspace, logger, writeConcurrency = 50 }) {
    this._client = new Client({
      contactPoints,
      localDataCenter: localDc,
      keyspace,
      policies: {
        retry: new policies.retry.DefaultRetryPolicy(),
      },
      queryOptions: {
        consistency: types.consistencies.localOne,
        prepare: true,
      },
    });
    this._keyspace = keyspace;
    this._logger = logger;
    this._writeConcurrency = writeConcurrency;
    this._limit = null;
    this._insertStmt = null;
    this._processedFilesInsertStmt = null;
    this._processedFilesSelectStmt = null;
    this._backfillProgressInsertStmt = null;

    // Partition write rate tracking
    this._partitionWindow = new Map();
    this._rateTimer = null;

    // Per-partition batch buffers (backfill mode)
    this._batchBuffers = new Map();
  }

  async connect() {
    await this._client.connect();
    this._insertStmt = await this._client.prepare(
      `INSERT INTO ${this._keyspace}.company_events
         (company, org_name, year_month, event_time, event_id, event_type, repo_name, actor_login, is_ai, tech_tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    this._processedFilesSelectStmt = await this._client.prepare(
      `SELECT file_name FROM ${this._keyspace}.processed_files WHERE file_name = ?`
    );
    this._processedFilesInsertStmt = await this._client.prepare(
      `INSERT INTO ${this._keyspace}.processed_files (file_name, processed_at, event_count, filtered_count)
       VALUES (?, ?, ?, ?)`
    );
    this._backfillProgressInsertStmt = await this._client.prepare(
      `INSERT INTO ${this._keyspace}.backfill_progress (run_id, date, status, completed_at, events_written)
       VALUES (?, ?, ?, ?, ?)`
    );
    this._limit = pLimit(this._writeConcurrency);
  }

  startRateLogger() {
    const TICK_INTERVAL_S = 5;
    this._rateTimer = setInterval(() => {
      if (this._partitionWindow.size === 0) return;
      const sorted = [...this._partitionWindow.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      this._logger.debug(
        { partitions: sorted.map(([k, v]) => ({ partition: k, writesPerSec: +(v / TICK_INTERVAL_S).toFixed(1) })) },
        'partition write rate'
      );
      this._partitionWindow.clear();
    }, TICK_INTERVAL_S * 1000);
    this._rateTimer.unref();
  }

  stopRateLogger() {
    if (this._rateTimer) clearInterval(this._rateTimer);
  }

  async isFileProcessed(fileName) {
    const result = await this._client.execute(this._processedFilesSelectStmt, [fileName], { prepare: true });
    return result.rowLength > 0;
  }

  async writeEvent(event) {
    const partitionKey = `${event.company}/${event.year_month}`;
    const cur = (this._partitionWindow.get(partitionKey) ?? 0) + 1;
    this._partitionWindow.set(partitionKey, cur);

    return this._limit(() => this._writeWithRetry(event));
  }

  // Backfill mode: buffers events per (company, year_month) partition.
  // Returns a flush promise if the buffer hit its threshold, otherwise resolves immediately.
  addBackfillEvent(event) {
    const partitionKey = `${event.company}/${event.year_month}`;
    const cur = (this._partitionWindow.get(partitionKey) ?? 0) + 1;
    this._partitionWindow.set(partitionKey, cur);

    if (!this._batchBuffers.has(partitionKey)) {
      this._batchBuffers.set(partitionKey, { rows: [], bytes: 0 });
    }
    const buf = this._batchBuffers.get(partitionKey);
    buf.rows.push(event);
    buf.bytes += estimateEventBytes(event);

    if (buf.rows.length >= BATCH_ROW_LIMIT || buf.bytes >= BATCH_BYTE_LIMIT) {
      const rows = buf.rows.splice(0);
      buf.bytes = 0;
      return this._flushBatch(partitionKey, rows);
    }
    return Promise.resolve();
  }

  // Flushes all non-empty per-partition buffers (called at end of each file and each date).
  async flushAllPartitionBuffers() {
    const flushes = [];
    for (const [partitionKey, buf] of this._batchBuffers.entries()) {
      if (buf.rows.length > 0) {
        const rows = buf.rows.splice(0);
        buf.bytes = 0;
        flushes.push(this._flushBatch(partitionKey, rows));
      }
    }
    await Promise.all(flushes);
  }

  async _flushBatch(partitionKey, rows) {
    const queries = rows.map(event => ({
      query: this._insertStmt,
      params: [
        event.company,
        event.org_name,
        event.year_month,
        new Date(event.event_time),
        event.event_id,
        event.event_type,
        event.repo_name,
        event.actor_login,
        event.is_ai,
        event.tech_tags,
      ],
    }));

    // MAX_RETRIES = 3 means: try once, then retry up to 3 more times with the
    // RETRY_DELAYS backoffs between attempts. Total attempts = 1 + MAX_RETRIES.
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this._client.batch(queries, { logged: false, prepare: true });
        return;
      } catch (err) {
        if (!isRetryable(err) || attempt === MAX_RETRIES) {
          const batchErr = new Error(err.message);
          batchErr.partitionKey = partitionKey;
          batchErr.sampleEventId = rows[0]?.event_id;
          throw batchErr;
        }
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
  }

  async writeBackfillProgress(runId, date, eventsWritten) {
    await this._client.execute(
      this._backfillProgressInsertStmt,
      [runId, types.LocalDate.fromString(date), 'completed', new Date(), eventsWritten],
      { prepare: true }
    );
  }

  async _writeWithRetry(event) {
    const params = [
      event.company,
      event.org_name,
      event.year_month,
      new Date(event.event_time),
      event.event_id,
      event.event_type,
      event.repo_name,
      event.actor_login,
      event.is_ai,
      event.tech_tags,
    ];

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        await this._client.execute(this._insertStmt, params, { prepare: true });
        return;
      } catch (err) {
        // Fail fast on non-transient errors (syntax error, invalid query, etc.)
        if (!isRetryable(err)) throw err;
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAYS[attempt]);
        } else {
          throw err;
        }
      }
    }
  }

  async markFileProcessed(fileName, eventCount, filteredCount) {
    await this._client.execute(
      this._processedFilesInsertStmt,
      [fileName, new Date(), eventCount, filteredCount],
      { prepare: true }
    );
  }

  async shutdown() {
    this.stopRateLogger();
    await this._client.shutdown();
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function estimateEventBytes(event) {
  return 50 +
    (event.company?.length ?? 0) +
    (event.org_name?.length ?? 0) +
    (event.year_month?.length ?? 0) +
    8 + // event_time (timestamp)
    (event.event_id?.length ?? 0) + // event_id (string, ~10-12 chars for GH Archive ids)
    (event.event_type?.length ?? 0) +
    (event.repo_name?.length ?? 0) +
    (event.actor_login?.length ?? 0) +
    1 + // is_ai (boolean)
    (event.tech_tags?.reduce((acc, tag) => acc + (tag?.length ?? 0) + 4, 0) ?? 0);
}

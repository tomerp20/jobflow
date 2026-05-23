import cassandra from 'cassandra-driver';
import pLimit from 'p-limit';

const { Client, types } = cassandra;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [100, 500, 2000];

export class CassandraWriter {
  constructor({ contactPoints, localDc, keyspace, logger, writeConcurrency = 50 }) {
    this._client = new Client({
      contactPoints,
      localDataCenter: localDc,
      keyspace,
      policies: {
        retry: new cassandra.policies.retry.RetryPolicy(),
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

    // Partition write rate tracking
    this._partitionCounts = new Map();
    this._partitionWindow = new Map();
    this._rateTimer = null;
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
    this._limit = pLimit(this._writeConcurrency);
  }

  startRateLogger() {
    this._rateTimer = setInterval(() => {
      if (this._partitionWindow.size === 0) return;
      const sorted = [...this._partitionWindow.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      this._logger.debug({ partitions: sorted.map(([k, v]) => ({ partition: k, ratePerSec: v })) }, 'partition write rate');
      this._partitionWindow.clear();
    }, 5000);
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

    for (let attempt = 0; attempt <= MAX_RETRIES - 1; attempt++) {
      try {
        await this._client.execute(this._insertStmt, params, { prepare: true });
        return;
      } catch (err) {
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

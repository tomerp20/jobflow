import { workerData, parentPort } from 'worker_threads';
import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import { extractTags } from './lib/tag-extractor.js';
import { detectAI } from './lib/ai-detector.js';

const { orgRegexSource, orgToCompany } = workerData;
if (!orgRegexSource) throw new Error('workerData.orgRegexSource is required');

// Rebuild RegExp from transferred source string (RegExp is not transferable)
const orgRegex = new RegExp(orgRegexSource);

const ALLOWED_TYPES = new Set(['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'ReleaseEvent']);

// Batch extracted events back to main in chunks. 500 keeps postMessage overhead low
// without ballooning main-thread Cassandra dispatch latency.
const EVENT_BATCH_SIZE = 500;

parentPort.on('message', async (msg) => {
  if (msg?.type === 'processFile') {
    await processFile(msg.hourId, msg.filePath);
  } else if (msg?.type === 'shutdown') {
    process.exit(0);
  }
});

async function processFile(hourId, filePath) {
  let totalEmitted = 0;
  let droppedNoTimestamp = 0;
  let droppedNoId = 0;
  let batch = [];

  function flushBatch() {
    if (batch.length === 0) return;
    parentPort.postMessage({ type: 'events', hourId, results: batch });
    batch = [];
  }

  let fileStream;
  let gunzip;
  let rl;
  try {
    fileStream = createReadStream(filePath);
    gunzip = createGunzip();
    rl = createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });

    for await (const line of rl) {
      // Fast filter: substring regex on raw line before any JSON.parse
      if (!orgRegex.test(line)) continue;

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (!ALLOWED_TYPES.has(event.type)) continue;

      const repoName = event.repo?.name ?? '';
      const org = repoName.split('/')[0];
      const company = orgToCompany[org];
      if (!company) continue;

      const createdAt = event.created_at;
      if (!createdAt) { droppedNoTimestamp++; continue; }
      if (!event.id) { droppedNoId++; continue; }

      const yearMonth = new Date(createdAt).toISOString().slice(0, 7);
      const techTags = [...extractTags(event)];
      const isAI = detectAI(event);

      batch.push({
        company,
        org_name: org,
        year_month: yearMonth,
        event_time: createdAt,
        event_id: String(event.id),
        event_type: event.type,
        repo_name: repoName,
        actor_login: event.actor?.login ?? '',
        is_ai: isAI,
        tech_tags: techTags,
      });
      totalEmitted++;

      if (batch.length >= EVENT_BATCH_SIZE) flushBatch();
    }

    flushBatch();
    parentPort.postMessage({
      type: 'fileDone',
      hourId,
      totalEmitted,
      droppedNoTimestamp,
      droppedNoId,
    });
  } catch (err) {
    try { rl?.close(); } catch {}
    try { fileStream?.destroy(); } catch {}
    parentPort.postMessage({
      type: 'workerError',
      hourId,
      message: err?.message ?? String(err),
    });
  }
}

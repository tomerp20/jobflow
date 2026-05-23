import { workerData, parentPort } from 'worker_threads';
import { extractTags } from './lib/tag-extractor.js';
import { detectAI } from './lib/ai-detector.js';

const { orgRegexSource, orgToCompany } = workerData;
if (!orgRegexSource) throw new Error('workerData.orgRegexSource is required');

// Rebuild RegExp from transferred source string (RegExp is not transferable)
const orgRegex = new RegExp(orgRegexSource);

const ALLOWED_TYPES = new Set(['PushEvent', 'PullRequestEvent', 'IssuesEvent', 'ReleaseEvent']);

parentPort.on('message', (lines) => {
  const results = [];
  let droppedNoTimestamp = 0;
  let droppedNoId = 0;

  for (const line of lines) {
    // Fast filter: substring regex on raw line before any JSON.parse
    if (!orgRegex.test(line)) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    // 4-type filter
    if (!ALLOWED_TYPES.has(event.type)) continue;

    // Company filter via orgToCompany map
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

    results.push({
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
  }

  parentPort.postMessage({ results, droppedNoTimestamp, droppedNoId });
});

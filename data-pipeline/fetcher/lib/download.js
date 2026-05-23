import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import path from 'path';
import { hourIdToPath } from './disk-layout.js';

const GH_ARCHIVE_BASE = 'https://data.gharchive.org';
const MAX_ATTEMPTS = 4;
const INITIAL_BACKOFF_MS = 1000;

// Returns a discriminated-union result:
//   { status: 'written' | 'skipped-already-present' | 'not-found' | 'failed-after-retries', hourId, error? }
export async function downloadHour(root, hourId) {
  const finalPath = hourIdToPath(root, hourId);

  if (existsSync(finalPath)) {
    return { status: 'skipped-already-present', hourId };
  }

  mkdirSync(path.dirname(finalPath), { recursive: true });

  const url = `${GH_ARCHIVE_BASE}/${hourId}.json.gz`;
  const partialPath = `${finalPath}.partial`;
  let lastError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(INITIAL_BACKOFF_MS * 2 ** (attempt - 1));
    }

    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      lastError = err;
      tryUnlink(partialPath);
      continue;
    }

    if (res.status === 404) {
      await res.body?.cancel();
      return { status: 'not-found', hourId };
    }

    if (res.status >= 500) {
      await res.body?.cancel();
      lastError = new Error(`HTTP ${res.status}`);
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel();
      return { status: 'failed-after-retries', hourId, error: `HTTP ${res.status}` };
    }

    try {
      await pipeline(Readable.fromWeb(res.body), createWriteStream(partialPath));
    } catch (err) {
      lastError = err;
      tryUnlink(partialPath);
      continue;
    }

    try {
      renameSync(partialPath, finalPath);
    } catch (err) {
      tryUnlink(partialPath);
      return { status: 'failed-after-retries', hourId, error: err.message };
    }
    return { status: 'written', hourId };
  }

  return { status: 'failed-after-retries', hourId, error: lastError?.message };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tryUnlink(p) {
  try { unlinkSync(p); } catch {}
}

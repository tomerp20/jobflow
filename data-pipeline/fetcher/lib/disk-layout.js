import { readdirSync, unlinkSync } from 'fs';
import path from 'path';

// hourId: YYYY-MM-DD-H (month/day zero-padded, hour unpadded 0–23)
// returns: <root>/YYYY/MM/DD/H.json.gz
export function hourIdToPath(root, hourId) {
  const [year, month, day, hour] = hourId.split('-');
  return path.join(root, year, month, day, `${hour}.json.gz`);
}

// Inverse of hourIdToPath — recovers the canonical hour ID from an on-disk path.
export function pathToHourId(root, filePath) {
  const rel = path.relative(root, filePath);
  const parts = rel.split(path.sep);
  const [year, month, day, file] = parts;
  const hour = file.replace(/\.json\.gz$/, '');
  return `${year}-${month}-${day}-${parseInt(hour, 10)}`;
}

// Returns all hour IDs (YYYY-MM-DD-H) for every UTC hour in [startDate, endDate] inclusive.
// startDate / endDate: 'YYYY-MM-DD'
export function enumerateRange(startDate, endDate) {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const start = Date.UTC(sy, sm - 1, sd, 0);
  const end = Date.UTC(ey, em - 1, ed, 23);
  const hours = [];
  for (let t = start; t <= end; t += 3_600_000) {
    const d = new Date(t);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hour = d.getUTCHours();
    hours.push(`${year}-${month}-${day}-${hour}`);
  }
  return hours;
}

// Returns the most recent hour ID (YYYY-MM-DD-H) found under rootDir, or null if empty.
export function latestOnDisk(rootDir) {
  const ids = [];
  _collectHourIds(rootDir, rootDir, ids);
  if (ids.length === 0) return null;
  return ids.reduce((best, cur) => _hourIdToMs(cur) > _hourIdToMs(best) ? cur : best);
}

function _collectHourIds(root, dir, ids) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      _collectHourIds(root, full, ids);
    } else if (entry.name.endsWith('.json.gz')) {
      ids.push(pathToHourId(root, full));
    }
  }
}

function _hourIdToMs(hourId) {
  const [y, m, d, h] = hourId.split('-').map(Number);
  return Date.UTC(y, m - 1, d, h);
}

// Recursively removes every *.partial file under root. Silently skips missing directories.
export function cleanPartials(root) {
  _sweepDir(root);
}

function _sweepDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      _sweepDir(full);
    } else if (entry.name.endsWith('.partial')) {
      try { unlinkSync(full); } catch {}
    }
  }
}

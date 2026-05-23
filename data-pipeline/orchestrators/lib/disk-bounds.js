import { enumerateAllOnDisk } from 'disk-layout';

export function earliestOnDisk(rootDir) {
  const ids = enumerateAllOnDisk(rootDir);
  if (ids.length === 0) {
    throw new Error(`no .json.gz files found under GHARCHIVE_DIR: ${rootDir}`);
  }
  // ids are sorted chronologically (earliest first); strip the hour component
  return ids[0].slice(0, 10); // YYYY-MM-DD
}

export function latestOnDisk(rootDir) {
  const ids = enumerateAllOnDisk(rootDir);
  if (ids.length === 0) {
    throw new Error(`no .json.gz files found under GHARCHIVE_DIR: ${rootDir}`);
  }
  // ids are sorted chronologically (earliest first); last element is the latest
  return ids[ids.length - 1].slice(0, 10); // YYYY-MM-DD
}

export function yesterdayUtc() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

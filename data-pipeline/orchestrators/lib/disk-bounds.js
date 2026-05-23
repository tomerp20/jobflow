import { enumerateAllOnDisk } from 'disk-layout';

export function earliestOnDisk(rootDir) {
  const ids = enumerateAllOnDisk(rootDir);
  if (ids.length === 0) {
    throw new Error(`no .json.gz files found under GHARCHIVE_DIR: ${rootDir}`);
  }
  // ids are sorted chronologically (earliest first); strip the hour component
  return ids[0].slice(0, 10); // YYYY-MM-DD
}

// Returns the latest YYYY-MM-DD on disk for which hour 23 is present —
// i.e. the latest *complete* day. Returning a partial-day date as a backfill
// endDate would cause the Ingester to ENOENT-crash on the missing hours
// (enumerateRange always expands a date to hours 0–23). If no complete day
// exists, throws so the operator can wait for the Fetcher to finish that day.
//
// Named `latestCompleteDateOnDisk` (not `latestOnDisk`) to avoid colliding
// with `disk-layout`'s `latestOnDisk` which returns the full hour ID.
export function latestCompleteDateOnDisk(rootDir) {
  const ids = enumerateAllOnDisk(rootDir);
  if (ids.length === 0) {
    throw new Error(`no .json.gz files found under GHARCHIVE_DIR: ${rootDir}`);
  }
  // Walk from the latest id backwards; first id whose hour component is 23
  // marks the latest complete date.
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    // hour component is the segment after the date prefix "YYYY-MM-DD-"
    const hour = parseInt(id.slice(11), 10);
    if (hour === 23) return id.slice(0, 10); // YYYY-MM-DD
  }
  throw new Error(
    `no complete day (hour 23 present) under GHARCHIVE_DIR: ${rootDir} — wait for the Fetcher to finish the current day`
  );
}

// Returns both bounds from a single enumerateAllOnDisk walk — avoids two
// recursive readdirSync passes when the orchestrator needs both endpoints
// in the fresh-run path.
export function diskBounds(rootDir) {
  const ids = enumerateAllOnDisk(rootDir);
  if (ids.length === 0) {
    throw new Error(`no .json.gz files found under GHARCHIVE_DIR: ${rootDir}`);
  }
  const earliest = ids[0].slice(0, 10);
  let latestComplete = null;
  for (let i = ids.length - 1; i >= 0; i--) {
    const hour = parseInt(ids[i].slice(11), 10);
    if (hour === 23) {
      latestComplete = ids[i].slice(0, 10);
      break;
    }
  }
  if (latestComplete === null) {
    throw new Error(
      `no complete day (hour 23 present) under GHARCHIVE_DIR: ${rootDir} — wait for the Fetcher to finish the current day`
    );
  }
  return { earliest, latestComplete };
}

export function yesterdayUtc() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

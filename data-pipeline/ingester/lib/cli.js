const HOUR_RE = /^\d{4}-\d{2}-\d{2}-\d{1,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// timeuuid (RFC 4122 v1): 8-4-4-4-12 hex, with the version nibble of the third group = 1.
const TIMEUUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fast-fail if --run-id is missing or not a timeuuid. Calling at parse time
// avoids ~30 min of wasted work before Cassandra rejects the cast at write time.
function requireValidRunIdForBackfill(mode, runId) {
  if (mode !== 'backfill') return;
  if (!runId) {
    die('--run-id is required when --mode backfill is in effect');
  }
  if (!TIMEUUID_RE.test(runId)) {
    die('--run-id must be a valid timeuuid (e.g. 6ba7b810-9dad-11d1-80b4-00c04fd430c8)');
  }
}

// Parses --target-companies wix:wix,microsoft:azure into [{company, org}, ...]
function parseTargetCompanies(raw) {
  if (!raw || !raw.trim()) {
    die('--target-companies is required (e.g. --target-companies wix:wix,microsoft:azure)');
  }
  const pairs = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (pairs.length === 0) {
    die('--target-companies must contain at least one company:org pair');
  }
  return pairs.map(pair => {
    const colon = pair.indexOf(':');
    if (colon === -1) die(`invalid --target-companies entry "${pair}" — expected company:org format`);
    const rawCompany = pair.slice(0, colon).trim();
    const rawOrg = pair.slice(colon + 1).trim();
    if (!rawCompany || !rawOrg) die(`invalid --target-companies entry "${pair}" — company and org must be non-empty`);
    // Components are URL-encoded by the Backfill Orchestrator so values
    // containing ':' or ',' survive the wire format. Decode each side
    // separately so the operator knows which component was malformed.
    let company, org;
    try {
      company = decodeURIComponent(rawCompany);
    } catch {
      die(`invalid --target-companies entry "${pair}" — malformed URL encoding in company component`);
    }
    try {
      org = decodeURIComponent(rawOrg);
    } catch {
      die(`invalid --target-companies entry "${pair}" — malformed URL encoding in org component`);
    }
    return { company, org };
  });
}

// Parses process.argv and returns a command descriptor. Exits 1 on invalid input.
export function parseCLI(argv) {
  const args = argv.slice(2);
  const flags = {};

  // Extract named flags
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode') {
      flags.mode = args[++i];
    } else if (args[i] === '--target-companies') {
      flags.targetCompanies = args[++i];
    } else if (args[i] === '--hour') {
      flags.hour = args[++i];
    } else if (args[i] === '--range') {
      flags.rangeStart = args[++i];
      flags.rangeEnd = args[++i];
    } else if (args[i] === '--catchup') {
      flags.catchup = true;
    } else if (args[i] === '--run-id') {
      flags.runId = args[++i];
    } else {
      die(`unknown argument: ${args[i]}`);
    }
  }

  // Validate --target-companies (required)
  const targetCompanies = parseTargetCompanies(flags.targetCompanies);

  // Validate --mode if provided
  if (flags.mode !== undefined && flags.mode !== 'hourly' && flags.mode !== 'backfill') {
    die('--mode must be "hourly" or "backfill"');
  }

  // Dispatch by verb
  if (flags.hour !== undefined) {
    const hourId = flags.hour;
    if (!hourId || !HOUR_RE.test(hourId)) {
      die('--hour requires a valid YYYY-MM-DD-H value (e.g. 2025-05-01-15)');
    }
    const h = parseInt(hourId.split('-')[3], 10);
    if (h < 0 || h > 23) die('hour component must be 0–23');
    if (flags.mode === 'backfill') {
      die('--hour --mode backfill is not supported; use --range A A for a one-day backfill');
    }
    const mode = flags.mode ?? 'hourly';
    requireValidRunIdForBackfill(mode, flags.runId);
    return { verb: 'hour', hourId, mode, runId: flags.runId ?? null, targetCompanies };
  }

  if (flags.rangeStart !== undefined || flags.rangeEnd !== undefined) {
    const start = flags.rangeStart;
    const end = flags.rangeEnd;
    if (!start || !DATE_RE.test(start) || !end || !DATE_RE.test(end)) {
      die('--range requires two valid YYYY-MM-DD dates (e.g. --range 2025-05-01 2025-05-02)');
    }
    if (start > end) die('--range start date must be <= end date');
    const mode = flags.mode ?? 'backfill';
    requireValidRunIdForBackfill(mode, flags.runId);
    return { verb: 'range', start, end, mode, runId: flags.runId ?? null, targetCompanies };
  }

  if (flags.catchup) {
    if (flags.mode === 'backfill') {
      die('--catchup --mode backfill is not supported; the Backfill Orchestrator uses --range, not --catchup');
    }
    return { verb: 'catchup', mode: flags.mode ?? 'hourly', runId: null, targetCompanies };
  }

  die('usage: ingester.js --hour <YYYY-MM-DD-H> | --range <start> <end> | --catchup  --target-companies <company:org,...> [--mode hourly|backfill] [--run-id <timeuuid>]');
}

function die(msg) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

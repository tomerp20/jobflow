const HOUR_RE = /^\d{4}-\d{2}-\d{2}-\d{1,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    const company = pair.slice(0, colon).trim();
    const org = pair.slice(colon + 1).trim();
    if (!company || !org) die(`invalid --target-companies entry "${pair}" — company and org must be non-empty`);
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
    return { verb: 'hour', hourId, mode: flags.mode ?? 'hourly', targetCompanies };
  }

  if (flags.rangeStart !== undefined || flags.rangeEnd !== undefined) {
    const start = flags.rangeStart;
    const end = flags.rangeEnd;
    if (!start || !DATE_RE.test(start) || !end || !DATE_RE.test(end)) {
      die('--range requires two valid YYYY-MM-DD dates (e.g. --range 2025-05-01 2025-05-02)');
    }
    if (start > end) die('--range start date must be <= end date');
    return { verb: 'range', start, end, mode: flags.mode ?? 'backfill', targetCompanies };
  }

  if (flags.catchup) {
    if (flags.mode === 'backfill') {
      die('--catchup --mode backfill is not supported; the Backfill Orchestrator uses --range, not --catchup');
    }
    return { verb: 'catchup', mode: flags.mode ?? 'hourly', targetCompanies };
  }

  die('usage: ingester.js --hour <YYYY-MM-DD-H> | --range <start> <end> | --catchup  --target-companies <company:org,...> [--mode hourly|backfill]');
}

function die(msg) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

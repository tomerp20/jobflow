const HOUR_RE = /^\d{4}-\d{2}-\d{2}-\d{1,2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Parses process.argv and returns a command descriptor. Exits 1 on invalid input.
export function parseCLI(argv) {
  const args = argv.slice(2);

  if (args[0] === '--hour') {
    const hourId = args[1];
    if (!hourId || !HOUR_RE.test(hourId)) {
      die('--hour requires a valid YYYY-MM-DD-H value (e.g. 2025-05-01-15)');
    }
    const h = parseInt(hourId.split('-')[3], 10);
    if (h < 0 || h > 23) die('hour component must be 0–23');
    return { mode: 'hour', hourId };
  }

  if (args[0] === '--range') {
    const start = args[1];
    const end = args[2];
    if (!start || !DATE_RE.test(start) || !end || !DATE_RE.test(end)) {
      die('--range requires two valid YYYY-MM-DD dates (e.g. --range 2025-05-01 2025-05-02)');
    }
    if (start > end) {
      die('--range start date must be <= end date');
    }
    return { mode: 'range', start, end };
  }

  die('usage: fetcher.js --hour <YYYY-MM-DD-H> | --range <YYYY-MM-DD> <YYYY-MM-DD>');
}

function die(msg) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(1);
}

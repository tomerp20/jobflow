import { spawn } from 'child_process';
import { createInterface } from 'readline';

export function spawnIngester(argv, logger) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argv, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const childLogger = logger.child({ subprocess: 'ingester' });

    createInterface({ input: child.stdout }).on('line', line => {
      childLogger.info(line);
    });

    createInterface({ input: child.stderr }).on('line', line => {
      childLogger.error(line);
    });

    // 'error' fires when spawn itself fails (e.g. ENOENT on the script path).
    // Without this handler the promise would never settle and the orchestrator
    // would hang indefinitely.
    child.on('error', (err) => {
      childLogger.error({ err }, 'failed to spawn ingester');
      resolve(1);
    });

    // 'close' fires after stdio streams have drained, so the last buffered
    // lines from the child are guaranteed to be logged before we resolve.
    child.on('close', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

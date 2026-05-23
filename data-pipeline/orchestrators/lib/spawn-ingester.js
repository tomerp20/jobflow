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

    child.on('exit', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

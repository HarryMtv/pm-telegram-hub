import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import { healthService, withTimeout } from './health.js';
import { logger } from './logger.js';
import { getRedis } from './queue/connection.js';
import { startWorker, stopWorker } from './queue/worker.js';

async function start(): Promise<void> {
  healthService.register({
    name: 'queue',
    check: async () => {
      const pong = await withTimeout(
        getRedis()
          .ping()
          .catch(() => null),
        1500,
      );
      return pong === 'PONG';
    },
  });

  startWorker();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'worker shutting down');
    await stopWorker().catch((err) => logger.warn({ err }, 'worker stop error'));
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.info('worker process started');
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  start().catch((err) => {
    logger.error({ err }, 'worker fatal startup error');
    process.exit(1);
  });
}

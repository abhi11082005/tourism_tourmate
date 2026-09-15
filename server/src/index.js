import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { closePool } from './db/pool.js';
import { closeRedis } from './db/redis.js';
import { startSeatExpiryWorker } from './workers/seatExpiry.worker.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Tour Mate API listening');
});

// Long enough for a slow LLM stream to finish, short enough to free sockets.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 120_000;

const worker = startSeatExpiryWorker();

let shuttingDown = false;

/**
 * Drain in dependency order: stop accepting requests, stop the sweeper, then let
 * go of Postgres and Redis. Closing the stores first would fail in-flight
 * checkouts that are mid-transaction.
 */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 15_000);
  forceExit.unref();

  try {
    await new Promise((resolve) => server.close(resolve));
    await worker.stop();
    await Promise.allSettled([closePool(), closeRedis()]);
    logger.info('shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => void shutdown(signal));
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled rejection');
});

process.on('uncaughtException', (err) => {
  // State is unknown after this point; log, then let the supervisor restart us.
  logger.fatal({ err }, 'uncaught exception');
  void shutdown('uncaughtException');
});

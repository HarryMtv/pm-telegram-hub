import 'dotenv/config';

import { fileURLToPath, pathToFileURL } from 'node:url';
import { FastifyInstance } from 'fastify';

import { registerAdapters } from './adapters/index.js';
import * as apiRoutes from './api/routes.js';
import * as authRoute from './auth/routes.js';
import { startBot, stopBot } from './bot/index.js';
import * as botRoute from './bot/index.js';
import { config } from './config/index.js';
import { healthService, withTimeout } from './health.js';
import { logger } from './logger.js';
import { metricsText } from './metrics.js';
import { getRedis } from './queue/connection.js';
import * as webhookRoutes from './queue/routes.js';

export interface AppOptions {
  /** Register routes/plugins onto the app (webhook, api, bot hooks). */
  configure?: (app: FastifyInstance) => Promise<void> | void;
}

export async function buildServer(opts: AppOptions = {}): Promise<FastifyInstance> {
  const { default: Fastify } = await import('fastify');
  const app: FastifyInstance = Fastify({
    logger: false, // we use our own Pino instance (see src/logger.ts)
    bodyLimit: 1024 * 1024,
    trustProxy: true, // behind nginx — honor X-Forwarded-*
  });

  // Raw-body preservation (webhook-processing spec). The JSON parser stores the
  // original request bytes on `req.rawBody` before parsing, so signature
  // verification always uses the bytes the provider actually sent.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body: Buffer, done) => {
    try {
      const json = body.length ? JSON.parse(body.toString('utf8')) : undefined;
      req.rawBody = body;
      done(null, json);
    } catch (err) {
      done(err instanceof Error ? err : new Error('Invalid JSON payload'), undefined);
    }
  });

  app.get('/health', async () => healthService.report());
  app.get('/metrics', async () => metricsText());

  if (opts.configure) await opts.configure(app);

  // Static Mini App is registered LAST so it never shadows a backend route; its
  // SPA fallback only fires for requests no API route matched.
  if (config.serveMiniApp) await registerMiniApp(app);

  return app;
}

/**
 * Absolute path to the Mini App's Vite build, resolved relative to this compiled
 * module (`dist/server.js` → `../mini-app/dist`). The same relative layout holds
 * both locally (`pnpm build` + `mini-app build`) and in the Docker image
 * (`/app/dist` alongside `/app/mini-app/dist`).
 */
const MINI_APP_DIST = fileURLToPath(new URL('../mini-app/dist', import.meta.url));

/** Backend route prefixes that must 404 as JSON rather than fall back to the SPA. */
const API_PREFIXES = ['/api', '/webhooks', '/health', '/metrics'];

/**
 * Serve the Mini App's static build from the same Fastify instance so the whole
 * stack ships in one image (spec §11). `wildcard: false` makes @fastify/static
 * resolve real files (hashed assets, index.html) and defer everything else to the
 * not-found handler, which returns index.html for client-side routes and a JSON
 * 404 for unknown backend paths (or any non-GET).
 */
async function registerMiniApp(app: FastifyInstance): Promise<void> {
  const { default: fastifyStatic } = await import('@fastify/static');
  await app.register(fastifyStatic, {
    root: MINI_APP_DIST,
    prefix: '/',
    wildcard: false,
    // Don't auto-serve index.html at `/` with the immutable cache below — it
    // references the hashed assets and must be re-fetched every load (see `/` below).
    index: false,
    // Hashed asset filenames are content-addressed, so they're safe to cache hard.
    maxAge: '30d',
    immutable: true,
  });

  // The SPA entry point: served uncached at `/` and as the fallback for any
  // unmatched client-side route, so a redeploy's new asset hashes always load.
  // index.html carries the hashes, so it must never be cached.
  app.get('/', (_req, reply) => reply.sendFile('index.html', { maxAge: 0, immutable: false }));
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || API_PREFIXES.some((p) => req.url.startsWith(p))) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    return reply.sendFile('index.html', { maxAge: 0, immutable: false });
  });
}

async function start(): Promise<void> {
  registerAdapters();

  // Health: report Redis/queue connectivity.
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

  const app = await buildServer({
    configure: async (a) => {
      await webhookRoutes.register(a);
      await botRoute.register(a);
      await authRoute.register(a);
      await apiRoutes.register(a);
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    await stopBot().catch((err) => logger.warn({ err }, 'bot stop error'));
    await app.close().catch((err) => logger.warn({ err }, 'error during shutdown'));
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
  await startBot().catch((err) =>
    logger.error({ err: (err as Error).message }, 'bot start failed'),
  );
  logger.info({ port: config.port, mode: config.telegram.botMode }, 'server started');
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  start().catch((err) => {
    logger.error({ err }, 'fatal startup error');
    process.exit(1);
  });
}

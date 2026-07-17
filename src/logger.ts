import pino from 'pino';

import { config } from './config/index.js';

/**
 * Single structured logger (Pino). Logs go to stdout — the deployment layer
 * (journald / docker logs / logrotate on the host) handles persistence.
 *
 * `LOG_LEVEL` is optional and defaults to the Node environment.
 */
const level = (process.env.LOG_LEVEL ?? (config.isProduction ? 'info' : 'debug')).toLowerCase();

export const logger = pino({
  level,
  base: { service: 'pm-telegram-hub' },
  redact: {
    paths: [
      // Never log secrets even if they appear in error payloads.
      '*.credentials',
      '*.token',
      '*.secret',
      'req.headers.authorization',
      'req.headers["x-signature"]',
      'req.headers["x-hook-secret"]',
      'req.headers["x-hub-signature"]',
      'req.headers["x-telegram-bot-api-secret-token"]',
    ],
    censor: '[REDACTED]',
  },
});

export type Logger = typeof logger;

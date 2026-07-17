import { env, isProduction, isTest } from './env.js';

export { env, isProduction, isTest };

export const config = {
  isProduction,
  isTest,

  port: env.PORT,

  /** Public base URL of the Integration Service (Fastify). */
  appUrl: env.APP_URL,
  miniAppUrl: env.MINIAPP_URL,

  /** Full public webhook endpoint for a provider, e.g. https://api.../webhooks/clickup. */
  webhookUrlFor(provider: string): string {
    return `${env.APP_URL.replace(/\/+$/, '')}/webhooks/${encodeURIComponent(provider)}`;
  },

  supabaseUrl: env.SUPABASE_URL,
  supabaseServiceKey: env.SUPABASE_SERVICE_KEY,

  encryptionKeyHex: env.ENCRYPTION_KEY,

  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN,
    botMode: env.BOT_MODE,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
  },

  jwtSecret: env.JWT_SECRET,

  redisUrl: env.REDIS_URL,

  rateLimitDefaults: {
    clickup: env.CLICKUP_RATE_LIMIT_DEFAULT,
    wrike: env.WRIKE_RATE_LIMIT_DEFAULT,
  },
} as const;

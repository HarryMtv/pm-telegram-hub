import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false'])
  .catch('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  APP_URL: z.string().url(),
  MINIAPP_URL: z.string().url(),

  // Serve the Mini App's Vite build from Fastify itself (single-image deploy).
  // Off by default: in local dev the Mini App runs on its own Vite server.
  SERVE_MINI_APP: booleanish,

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),

  // 32 bytes encoded as 64 hex characters.
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 32 bytes (64 hex chars)'),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  BOT_MODE: z.enum(['webhook', 'polling']).default('polling'),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),

  JWT_SECRET: z.string().min(16),

  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  CLICKUP_RATE_LIMIT_DEFAULT: z.coerce.number().int().positive().default(100),
  WRIKE_RATE_LIMIT_DEFAULT: z.coerce.number().int().positive().default(100),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast: never boot with an incomplete/invalid configuration.
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

export { booleanish };

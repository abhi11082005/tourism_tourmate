import { config } from 'dotenv';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// server/.env wins; the repo root .env is the fallback so a single file at the
// top level also works. dotenv never overwrites an existing process.env value,
// so real environment variables (Docker, CI, a hosting dashboard) always win
// over both files.
for (const candidate of ['../../.env', '../../../.env']) {
  config({ path: path.resolve(__dirname, candidate) });
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('*'),

  DATABASE_URL: z.string().url(),
  PGPOOL_MAX: z.coerce.number().int().positive().default(20),
  PGPOOL_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  PG_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  REDIS_URL: z.string().url(),
  SEAT_HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  JWT_SECRET: z.string().min(24, 'JWT_SECRET must be at least 24 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  OSRM_BASE_URL: z.string().url(),
  OSRM_PROFILE: z.enum(['foot', 'bike', 'car']).default('foot'),

  /*
   * Payments. Both are optional so the rest of the app still boots on a machine
   * with no gateway account — `paymentsEnabled` below is what the code checks.
   * The secret is server-only: it signs and verifies, and must never be sent to
   * the browser. Only RAZORPAY_KEY_ID is safe to hand to the checkout script.
   */
  RAZORPAY_KEY_ID: z.string().trim().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().trim().min(1).optional(),
  PAYMENT_CURRENCY: z.string().trim().length(3).toUpperCase().default('INR'),

  LLM_PROVIDER: z.enum(['groq', 'gemini', 'none']).default('none'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('llama-3.1-8b-instant'),
  // Must equal the vector(N) width in db/migrations/0001_init.sql. 768 is what
  // Ollama's nomic-embed-text returns (the free local default). Change both this
  // and the migration together if you move to a 1536-dim provider.
  EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // Fail fast and loudly — a half-configured server silently double-books seats.
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = Object.freeze(parsed.data);
export const isProd = env.NODE_ENV === 'production';

/*
 * A gateway is only usable when BOTH halves are present. Checking this once here
 * means routes never have to guess, and a half-filled .env fails visibly at the
 * payment step instead of throwing deep inside the SDK.
 */
export const paymentsEnabled = Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

// `rzp_test_*` keys move no real money. Shipping them to production means every
// booking looks paid while nothing is ever settled, so refuse to boot instead.
if (isProd && env.RAZORPAY_KEY_ID?.startsWith('rzp_test_')) {
  throw new Error('Refusing to boot in production with a Razorpay test key.');
}

// Matches any of the shipped placeholders, not one exact string, so editing the
// example file's wording can't quietly disable this guard.
if (isProd && env.JWT_SECRET.startsWith('change-me')) {
  throw new Error('Refusing to boot in production with the default JWT_SECRET.');
}

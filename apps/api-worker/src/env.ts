import { z } from 'zod';

/**
 * Cloudflare bindings declared in wrangler.jsonc, plus the string-valued vars
 * and secrets. Hono's generic `Bindings` type param is this interface, so
 * `c.env.HYPERDRIVE` etc. are typed everywhere.
 *
 * Binding objects (Hyperdrive, R2Bucket, Queue, RateLimit) are opaque to Zod
 * — they're validated by presence (see `assertBinding`), not shape. Only the
 * string vars/secrets go through `envSchema`.
 */
export interface Bindings {
  // --- Bindings (wrangler.jsonc) --------------------------------------
  HYPERDRIVE: Hyperdrive;
  DOCUMENTS: R2Bucket;
  REMINDERS_QUEUE: Queue;
  // One Rate Limiting binding per route — see the comment above these in
  // wrangler.jsonc for why (Nest's default tracker keys per-route, not just
  // per limit value).
  RATE_LIMITER_AUTH_REGISTER: RateLimit;
  RATE_LIMITER_AUTH_LOGOUT: RateLimit;
  RATE_LIMITER_AUTH_PASSWORD_RESET: RateLimit;
  RATE_LIMITER_AUTH_PASSWORD_CHANGE: RateLimit;
  RATE_LIMITER_AUTH_TEST_OTP: RateLimit;
  RATE_LIMITER_AUTH_LOGIN: RateLimit;
  RATE_LIMITER_AUTH_GOOGLE: RateLimit;
  RATE_LIMITER_AUTH_GOOGLE_REGISTER: RateLimit;
  RATE_LIMITER_AUTH_MFA_VERIFY: RateLimit;
  RATE_LIMITER_AUTH_OTP_VERIFY: RateLimit;
  RATE_LIMITER_AUTH_OTP_REQUEST: RateLimit;
  RATE_LIMITER_AUTH_PASSWORD_FORGOT: RateLimit;
  RATE_LIMITER_AUTH_REFRESH: RateLimit;
  RATE_LIMITER_AUTH_ME: RateLimit;
  RATE_LIMITER_USERS_ME_GET: RateLimit;
  RATE_LIMITER_USERS_ME_PATCH: RateLimit;
  RATE_LIMITER_THERAPISTS_CREDENTIALS: RateLimit;
  RATE_LIMITER_THERAPISTS_ONBOARDING: RateLimit;
  RATE_LIMITER_THERAPISTS_AVAILABILITY_GET: RateLimit;
  RATE_LIMITER_THERAPISTS_AVAILABILITY_PUT: RateLimit;
  RATE_LIMITER_THERAPISTS_DOCUMENTS_UPLOAD: RateLimit;
  RATE_LIMITER_THERAPISTS_DOCUMENTS_LIST: RateLimit;
  RATE_LIMITER_THERAPISTS_SEARCH: RateLimit;
  RATE_LIMITER_THERAPISTS_DETAIL: RateLimit;
  RATE_LIMITER_THERAPISTS_DOCUMENT_DOWNLOAD: RateLimit;
  RATE_LIMITER_ADMIN_THERAPISTS_LIST: RateLimit;
  RATE_LIMITER_ADMIN_THERAPISTS_DETAIL: RateLimit;
  RATE_LIMITER_ADMIN_THERAPISTS_REVIEW: RateLimit;
  RATE_LIMITER_ADMIN_ALERTS_LIST: RateLimit;
  RATE_LIMITER_ADMIN_ALERTS_COUNT: RateLimit;
  RATE_LIMITER_ADMIN_ALERTS_ACKNOWLEDGE: RateLimit;
  RATE_LIMITER_ADMIN_ALERTS_RESOLVE: RateLimit;
  RATE_LIMITER_INTAKE_SUBMIT: RateLimit;
  RATE_LIMITER_INTAKE_LATEST: RateLimit;
  RATE_LIMITER_INTAKE_HISTORY: RateLimit;
  RATE_LIMITER_THERAPISTS_SLOTS: RateLimit;
  RATE_LIMITER_APPOINTMENTS_CREATE: RateLimit;
  RATE_LIMITER_APPOINTMENTS_LIST: RateLimit;
  RATE_LIMITER_APPOINTMENTS_DETAIL: RateLimit;
  RATE_LIMITER_APPOINTMENTS_CANCEL: RateLimit;
  RATE_LIMITER_SESSIONS_ACCESS: RateLimit;
  RATE_LIMITER_SESSIONS_START: RateLimit;
  RATE_LIMITER_SESSIONS_END: RateLimit;
  RATE_LIMITER_PAYMENTS_MPESA_CALLBACK: RateLimit;
  RATE_LIMITER_PAYMENTS_PAYHERO_CALLBACK: RateLimit;
  RATE_LIMITER_PAYMENTS_STATUS: RateLimit;
  AUTH_KV: KVNamespace;

  // --- Vars (wrangler.jsonc `vars`, non-secret) -----------------------
  API_PUBLIC_URL: string;
  CORS_ORIGINS: string;
  PROVIDER_MODE: string;
  MPESA_MODE: string;
  VIDEO_MODE: string;
  AI_MODE: string;
  SMS_MODE: string;
  EMAIL_MODE: string;
  BEFRIENDERS_KENYA_HOTLINE: string;

  // --- Secrets (`wrangler secret put`) --------------------------------
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_TTL?: string;
  JWT_REFRESH_TTL?: string;
  PASSWORD_SALT_ROUNDS?: string;
  PHI_ENCRYPTION_KEY: string;
  MPESA_CALLBACK_URL?: string;
  PAYHERO_API_USERNAME?: string;
  PAYHERO_API_PASSWORD?: string;
  PAYHERO_CHANNEL_ID?: string;
  PAYHERO_BASE_URL?: string;
  DAILY_API_KEY?: string;
  DAILY_DOMAIN?: string;
  DAILY_BASE_URL?: string;
  AT_USERNAME?: string;
  AT_API_KEY?: string;
  AT_SENDER_ID?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
}

const providerMode = z.enum(['mock', 'live']);

/**
 * Validates the string-valued subset of `env` (vars + secrets). Fails fast
 * with a readable error on an invalid or incomplete configuration — same
 * posture as apps/api/src/config/env.schema.ts, minus the fields that moved
 * to bindings (DATABASE_URL -> HYPERDRIVE, REDIS_URL -> gone, document
 * storage dir -> DOCUMENTS R2 bucket) and SMTP_* -> RESEND_API_KEY.
 */
export const envSchema = z.object({
  API_PUBLIC_URL: z.string().url().default('https://api.suluhutherapy.com'),
  CORS_ORIGINS: z.string().default('https://suluhutherapy.com'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  PASSWORD_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  PHI_ENCRYPTION_KEY: z
    .string()
    .min(1, 'PHI_ENCRYPTION_KEY is required')
    .refine((v) => base64ByteLength(v) === 32, {
      message: 'PHI_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    }),

  PROVIDER_MODE: providerMode.default('mock'),
  MPESA_MODE: providerMode.default('mock'),
  VIDEO_MODE: providerMode.default('mock'),
  AI_MODE: providerMode.default('mock'),
  SMS_MODE: providerMode.default('mock'),
  EMAIL_MODE: providerMode.default('mock'),

  // PayHero (M-Pesa Daraja aggregator) — required only when MPESA_MODE=live.
  MPESA_CALLBACK_URL: z.string().url().optional(),
  PAYHERO_API_USERNAME: z.string().optional(),
  PAYHERO_API_PASSWORD: z.string().optional(),
  PAYHERO_CHANNEL_ID: z.coerce.number().int().positive().optional(),
  PAYHERO_BASE_URL: z.string().url().default('https://backend.payhero.co.ke'),

  // Daily.co video — required only when VIDEO_MODE=live.
  DAILY_API_KEY: z.string().optional(),
  DAILY_DOMAIN: z.string().optional(),
  DAILY_BASE_URL: z.string().url().default('https://api.daily.co/v1'),

  // Africa's Talking SMS — required only when SMS_MODE=live.
  AT_USERNAME: z.string().optional(),
  AT_API_KEY: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),

  // Resend HTTP API — required only when EMAIL_MODE=live. Workers can't open
  // raw SMTP sockets, so (unlike apps/api) this talks to Resend over fetch.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Suluhu Therapy Center <no-reply@suluhu.co.ke>'),

  // Sign in with Google — the OAuth Web client ID. Disabled when unset.
  GOOGLE_CLIENT_ID: z.string().optional(),

  BEFRIENDERS_KENYA_HOTLINE: z.string().default('0800723253'),
});

export type Env = z.infer<typeof envSchema>;

/** Decoded byte length of a base64 string, without a Buffer/Node dependency. */
function base64ByteLength(base64: string): number {
  try {
    return atob(base64).length;
  } catch {
    return -1;
  }
}

/**
 * Treats a blank var as absent — mirrors apps/api's env validation, where a
 * secret that's merely declared (but empty) in `wrangler.jsonc` `vars` for
 * local dev shouldn't be treated as "set".
 */
function dropBlanks(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
}

export class EnvValidationError extends Error {}

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(dropBlanks(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new EnvValidationError(`Invalid environment configuration:\n${issues}`);
  }

  if (parsed.data.MPESA_MODE === 'live') {
    const missing = (
      [
        'MPESA_CALLBACK_URL',
        'PAYHERO_API_USERNAME',
        'PAYHERO_API_PASSWORD',
        'PAYHERO_CHANNEL_ID',
      ] as const
    ).filter((key) => parsed.data[key] === undefined);
    if (missing.length > 0) {
      throw new EnvValidationError(
        `Invalid environment configuration:\n  • MPESA_MODE=live requires: ${missing.join(', ')}`,
      );
    }
  }

  if (parsed.data.VIDEO_MODE === 'live') {
    const missing = (['DAILY_API_KEY', 'DAILY_DOMAIN'] as const).filter((key) => !parsed.data[key]);
    if (missing.length > 0) {
      throw new EnvValidationError(
        `Invalid environment configuration:\n  • VIDEO_MODE=live requires: ${missing.join(', ')}`,
      );
    }
  }

  if (parsed.data.SMS_MODE === 'live') {
    const missing = (['AT_USERNAME', 'AT_API_KEY'] as const).filter((key) => !parsed.data[key]);
    if (missing.length > 0) {
      throw new EnvValidationError(
        `Invalid environment configuration:\n  • SMS_MODE=live requires: ${missing.join(', ')}`,
      );
    }
  }

  if (parsed.data.EMAIL_MODE === 'live') {
    const missing = (['RESEND_API_KEY'] as const).filter((key) => !parsed.data[key]);
    if (missing.length > 0) {
      throw new EnvValidationError(
        `Invalid environment configuration:\n  • EMAIL_MODE=live requires: ${missing.join(', ')}`,
      );
    }
  }

  return parsed.data;
}

/** Throws if a required Cloudflare binding wasn't attached to this Worker. */
export function assertBinding<K extends keyof Bindings>(
  env: Bindings,
  key: K,
): NonNullable<Bindings[K]> {
  const value = env[key];
  if (value === undefined || value === null) {
    throw new EnvValidationError(`Missing required binding: ${key} (see wrangler.jsonc)`);
  }
  return value as NonNullable<Bindings[K]>;
}

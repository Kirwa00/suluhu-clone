import type { Context, MiddlewareHandler } from 'hono';
import { AppException } from '../lib/app-exception';
import type { Bindings } from '../env';
import type { AppEnv } from '../types';

type RateLimiterBinding = Extract<keyof Bindings, `RATE_LIMITER_${string}`>;

/** The caller's IP — matches Nest's default `ThrottlerGuard` tracker (`req.ip`). */
export function clientIp(c: Context<AppEnv>): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/**
 * Per-route rate limiting — port of the `@Throttle(...)` overrides in
 * apps/api/src/modules/auth/auth.controller.ts, over a Workers Rate Limiting
 * binding instead of `@nestjs/throttler` + Redis. `binding` picks the
 * (limit, period) tier (see wrangler.jsonc); `keyFn` defaults to the client
 * IP, same as Nest's default tracker.
 */
export const rateLimit = (
  binding: RateLimiterBinding,
  keyFn: (c: Context<AppEnv>) => string = clientIp,
): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const { success } = await c.env[binding].limit({ key: keyFn(c) });
    if (!success) throw AppException.tooManyRequests();
    await next();
  };
};

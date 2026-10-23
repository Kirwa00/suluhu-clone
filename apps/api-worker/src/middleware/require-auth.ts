import type { MiddlewareHandler } from 'hono';
import { ErrorCode, UserStatus } from '@suluhu/shared';
import { AppException } from '../lib/app-exception';
import { must } from '../lib/must';
import { toAuthUser } from '../lib/token';
import type { AppEnv } from '../types';

/**
 * Per-route auth guard — port of apps/api's JwtAuthGuard, applied explicitly
 * to the routes that aren't `@Public()` in auth.controller.ts/
 * users.controller.ts, rather than globally-with-an-opt-out (Hono has no
 * direct equivalent of Nest's global `APP_GUARD` + reflector metadata).
 * Rejects a missing/invalid/expired/revoked token, and a suspended or
 * deactivated account even with an otherwise valid one.
 */
export const requireAuth = (): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const ctx = must(c.get('ctx'));
    const token = extractBearer(c.req.header('authorization'));
    if (!token) throw AppException.unauthorized();

    const payload = await ctx.tokens.verifyAccessToken(token);
    if (payload.status === UserStatus.SUSPENDED || payload.status === UserStatus.DEACTIVATED) {
      throw AppException.unauthorized('Account is not active', ErrorCode.ACCOUNT_SUSPENDED);
    }

    c.set('user', toAuthUser({ id: payload.sub, ...payload }));
    c.set('authJti', payload.jti);
    await next();
  };
};

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme === 'Bearer' && value ? value : null;
}

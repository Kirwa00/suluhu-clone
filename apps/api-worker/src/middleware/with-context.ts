import type { MiddlewareHandler } from 'hono';
import { createAuthContext } from '../lib/context';
import type { AppEnv } from '../types';

/**
 * Builds the request-scoped service graph (Prisma client, token/otp/audit/
 * notifications services, ...) once per request and stores it on the
 * context, so every handler/middleware downstream (requireAuth included)
 * reuses the same instances instead of each standing up its own Prisma
 * client.
 */
export const withAuthContext = (): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const validated = c.get('validatedEnv');
    if (!validated)
      throw new Error('validatedEnv not set — withAuthContext ran before env validation');
    c.set('ctx', await createAuthContext(c.env, validated));
    await next();
  };
};

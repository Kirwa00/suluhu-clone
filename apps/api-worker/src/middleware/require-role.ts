import type { MiddlewareHandler } from 'hono';
import type { UserRole } from '@suluhu/shared';
import { AppException } from '../lib/app-exception';
import { must } from '../lib/must';
import type { AppEnv } from '../types';

/**
 * Per-route RBAC guard — port of apps/api's `RolesGuard`. Must run after
 * `requireAuth()` (which sets `c.get('user')`). apps/api enforces `@Roles`
 * via global guard + reflector metadata; Hono has no direct equivalent, so
 * this is applied explicitly on each route that needs it, same approach as
 * `requireAuth()` itself.
 */
export const requireRole = (...roles: UserRole[]): MiddlewareHandler<AppEnv> => {
  return async (c, next) => {
    const user = must(c.get('user'));
    if (!roles.includes(user.role)) {
      throw AppException.forbidden('You do not have permission to perform this action');
    }
    await next();
  };
};

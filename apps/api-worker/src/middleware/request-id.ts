import type { MiddlewareHandler } from 'hono';

export interface RequestIdVariables {
  requestId: string;
}

/**
 * Assigns or propagates a correlation id for every request, echoed in the
 * `X-Request-Id` response header and the API envelope for tracing. Port of
 * apps/api/src/common/middleware/request-id.middleware.ts — uses
 * `crypto.randomUUID()` (a Workers/Web-standard global) instead of `nanoid`
 * since there's no reason to add the dependency here.
 */
export const requestId = (): MiddlewareHandler<{ Variables: RequestIdVariables }> => {
  return async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const id = incoming && incoming.length <= 64 ? incoming : crypto.randomUUID();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    await next();
  };
};

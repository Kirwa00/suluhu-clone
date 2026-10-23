import type { MiddlewareHandler } from 'hono';
import type { RequestIdVariables } from './request-id';

/**
 * Structured access logging. Port of
 * apps/api/src/common/interceptors/logging.interceptor.ts — same fields
 * (method, path, status, duration, correlation id), no PHI. `console.log`
 * output is captured by Workers Logs (see `observability` in wrangler.jsonc).
 */
export const accessLog = (): MiddlewareHandler<{ Variables: RequestIdVariables }> => {
  return async (c, next) => {
    const start = Date.now();
    try {
      await next();
      const ms = Date.now() - start;
      console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms [${c.get('requestId')}]`);
    } catch (error) {
      const ms = Date.now() - start;
      console.warn(`${c.req.method} ${c.req.path} errored after ${ms}ms [${c.get('requestId')}]`);
      throw error;
    }
  };
};

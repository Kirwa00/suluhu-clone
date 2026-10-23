import type { Context } from 'hono';
import type { AppEnv } from '../types';
import type { RequestContext } from './types';

/** Builds the request context (IP + user agent) for audit logging. */
export function requestContext(c: Context<AppEnv>): RequestContext {
  const forwarded = c.req.header('x-forwarded-for');
  const ipAddress = forwarded?.split(',')[0]?.trim() ?? c.req.header('cf-connecting-ip') ?? null;
  return { ipAddress, userAgent: c.req.header('user-agent') ?? null };
}

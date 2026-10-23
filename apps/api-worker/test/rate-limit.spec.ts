import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { onError } from '../src/lib/error-handler';
import { requestId } from '../src/middleware/request-id';
import { rateLimit } from '../src/middleware/rate-limit';
import type { AppEnv } from '../src/types';

/**
 * wrangler.jsonc's RATE_LIMITER_AUTH_OTP_REQUEST tier (3 req/60s) — the lowest
 * limit declared, so it's quickest to actually exhaust in a test.
 */
function buildTestApp() {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.onError(onError);
  app.get('/limited', rateLimit('RATE_LIMITER_AUTH_OTP_REQUEST'), (c) => c.json({ ok: true }));
  return app;
}

describe('rateLimit middleware', () => {
  it('allows requests under the limit and blocks once exceeded, keyed by IP', async () => {
    const app = buildTestApp();
    const fromIp = (ip: string) =>
      app.request('/limited', { headers: { 'cf-connecting-ip': ip } }, env);

    for (let i = 0; i < 3; i++) {
      const res = await fromIp('203.0.113.1');
      expect(res.status).toBe(200);
    }
    const blocked = await fromIp('203.0.113.1');
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');

    // A different caller has their own, unexhausted bucket.
    const otherCaller = await fromIp('203.0.113.2');
    expect(otherCaller.status).toBe(200);
  });
});

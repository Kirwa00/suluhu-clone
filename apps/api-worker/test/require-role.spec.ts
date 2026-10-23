import { Hono } from 'hono';
import { UserRole } from '@suluhu/shared';
import { describe, expect, it } from 'vitest';
import { onError } from '../src/lib/error-handler';
import { requestId } from '../src/middleware/request-id';
import { requireRole } from '../src/middleware/require-role';
import type { AppEnv } from '../src/types';

/** Builds a test app that stands in a given role as the authenticated user. */
function buildTestApp(role: UserRole) {
  const app = new Hono<AppEnv>();
  app.use('*', requestId());
  app.onError(onError);
  app.use('*', async (c, next) => {
    c.set('user', {
      id: 'u1',
      email: 'asha@example.com',
      role,
      status: 'ACTIVE',
      mfaEnabled: true,
    });
    await next();
  });
  app.get('/restricted', requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN), (c) =>
    c.json({ ok: true }),
  );
  return app;
}

describe('requireRole middleware', () => {
  it('allows a user whose role is in the required list', async () => {
    const res = await buildTestApp(UserRole.ADMIN).request('/restricted');
    expect(res.status).toBe(200);
  });

  it('rejects a user whose role is not required, with a forbidden code', async () => {
    const res = await buildTestApp(UserRole.PATIENT).request('/restricted');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects an unauthenticated request', async () => {
    const app = new Hono<AppEnv>();
    app.use('*', requestId());
    app.onError(onError);
    app.get('/restricted', requireRole(UserRole.ADMIN), (c) => c.json({ ok: true }));
    const res = await app.request('/restricted');
    expect(res.status).toBe(401);
  });
});

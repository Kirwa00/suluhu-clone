import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ApiResponse } from '@suluhu/shared';
import { AppException } from '../src/lib/app-exception';
import { onError } from '../src/lib/error-handler';
import { requestId, type RequestIdVariables } from '../src/middleware/request-id';
import type { Bindings } from '../src/env';

/**
 * Exercises the error-handling pipeline in isolation (no Prisma/pg) against
 * a throwaway app that mirrors how src/index.ts wires requestId + onError.
 */
function buildTestApp() {
  const app = new Hono<{ Bindings: Bindings; Variables: RequestIdVariables }>();
  app.use('*', requestId());
  app.onError(onError);

  app.get('/app-exception', () => {
    throw AppException.conflict('That email is already registered', 'AUTH_EMAIL_TAKEN');
  });
  app.get('/hono-exception', () => {
    throw new HTTPException(403, { message: 'nope' });
  });
  app.get('/zod-error', (c) => {
    const parsed = z.object({ name: z.string() }).parse({});
    return c.json(parsed);
  });
  app.get('/unexpected', () => {
    throw new Error('boom');
  });
  return app;
}

describe('error handling', () => {
  it('maps AppException to its code, status and details', async () => {
    const res = await buildTestApp().request('/app-exception');
    expect(res.status).toBe(409);
    const body = (await res.json()) as ApiResponse<null>;
    expect(body).toMatchObject({
      success: false,
      error: { code: 'AUTH_EMAIL_TAKEN', message: 'That email is already registered' },
    });
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });

  it("maps Hono's HTTPException via the standard status->code table", async () => {
    const res = await buildTestApp().request('/hono-exception');
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiResponse<null>;
    expect(body.error?.code).toBe('FORBIDDEN');
  });

  it('maps a ZodError to VALIDATION_FAILED with field-level details', async () => {
    const res = await buildTestApp().request('/zod-error');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse<null>;
    expect(body.error?.code).toBe('VALIDATION_FAILED');
    expect(body.error?.details).toHaveProperty('name');
  });

  it('never leaks internal error messages for unexpected errors', async () => {
    const res = await buildTestApp().request('/unexpected');
    expect(res.status).toBe(500);
    const body = (await res.json()) as ApiResponse<null>;
    expect(body.error?.code).toBe('INTERNAL');
    expect(body.error?.message).not.toContain('boom');
  });
});

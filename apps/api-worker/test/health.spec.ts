import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ApiResponse } from '@suluhu/shared';

describe('GET /api/v1/health/live', () => {
  it('reports alive without touching the database', async () => {
    const res = await SELF.fetch('https://api.suluhutherapy.com/api/v1/health/live');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<{ status: string }>;
    expect(body).toMatchObject({
      success: true,
      data: { status: 'alive' },
      error: null,
    });
    expect(body.meta.version).toBe('v1');
    expect(res.headers.get('X-Request-Id')).toBeTruthy();
  });
});

describe('unmatched route', () => {
  it('returns the standard error envelope with a 404', async () => {
    const res = await SELF.fetch('https://api.suluhutherapy.com/api/v1/nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiResponse<null>;
    expect(body).toMatchObject({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND' },
    });
  });
});

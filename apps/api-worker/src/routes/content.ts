import { Hono } from 'hono';
import { must } from '../lib/must';
import { successEnvelope } from '../lib/response';
import { requireAuth } from '../middleware/require-auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

// Port of apps/api's ContentController's public routes (`content`). The
// admin routes (`admin/content*`) live in routes/admin.ts, mounted under
// the shared `/admin` prefix.
export const content = new Hono<AppEnv>();

content.get('/', rateLimit('RATE_LIMITER_CONTENT_LIST'), requireAuth(), async (c) => {
  const result = await must(c.get('ctx')).content.listPublished({
    category: c.req.query('category'),
    type: c.req.query('type'),
    language: c.req.query('language'),
  });
  return c.json(successEnvelope(result, c.get('requestId')));
});

content.get('/:slug', rateLimit('RATE_LIMITER_CONTENT_DETAIL'), requireAuth(), async (c) => {
  const slug = c.req.param('slug');
  const result = await must(c.get('ctx')).content.getBySlug(slug);
  return c.json(successEnvelope(result, c.get('requestId')));
});

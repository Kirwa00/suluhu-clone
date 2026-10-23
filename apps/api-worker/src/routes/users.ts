import { Hono } from 'hono';
import { updateProfileSchema } from '@suluhu/shared';
import { must } from '../lib/must';
import { successEnvelope } from '../lib/response';
import { requireAuth } from '../middleware/require-auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

export const users = new Hono<AppEnv>();

users.get('/me', rateLimit('RATE_LIMITER_USERS_ME_GET'), requireAuth(), async (c) => {
  const userId = must(c.get('user')).id;
  const profile = await must(c.get('ctx')).users.getProfile(userId);
  return c.json(successEnvelope(profile, c.get('requestId')));
});

users.patch('/me', rateLimit('RATE_LIMITER_USERS_ME_PATCH'), requireAuth(), async (c) => {
  const userId = must(c.get('user')).id;
  const dto = updateProfileSchema.parse(await c.req.json().catch(() => ({})));
  const profile = await must(c.get('ctx')).users.updateProfile(userId, dto);
  return c.json(successEnvelope(profile, c.get('requestId')));
});

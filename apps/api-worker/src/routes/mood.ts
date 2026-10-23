import { Hono } from 'hono';
import { UserRole, moodEntrySchema } from '@suluhu/shared';
import { must } from '../lib/must';
import { successEnvelope } from '../lib/response';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

// Port of apps/api's MoodController (`mood`, @Roles(PATIENT)).
export const mood = new Hono<AppEnv>();

mood.post(
  '/',
  rateLimit('RATE_LIMITER_MOOD_CREATE'),
  requireAuth(),
  requireRole(UserRole.PATIENT),
  async (c) => {
    const dto = moodEntrySchema.parse(await c.req.json().catch(() => ({})));
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).mood.create(userId, dto);
    return c.json(successEnvelope(result, c.get('requestId')), 201);
  },
);

mood.get(
  '/',
  rateLimit('RATE_LIMITER_MOOD_LIST'),
  requireAuth(),
  requireRole(UserRole.PATIENT),
  async (c) => {
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).mood.list(userId);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

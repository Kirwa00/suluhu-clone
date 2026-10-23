import { Hono } from 'hono';
import { UserRole } from '@suluhu/shared';
import { must } from '../lib/must';
import { successEnvelope } from '../lib/response';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

// Port of apps/api's TherapistEarningsController (`therapist`, @Roles(THERAPIST)).
export const therapist = new Hono<AppEnv>();

therapist.get(
  '/earnings',
  rateLimit('RATE_LIMITER_THERAPIST_EARNINGS'),
  requireAuth(),
  requireRole(UserRole.THERAPIST),
  async (c) => {
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).analytics.therapistEarnings(userId);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

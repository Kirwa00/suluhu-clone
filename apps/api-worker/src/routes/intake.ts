import { Hono } from 'hono';
import { UserRole, submitIntakeSchema } from '@suluhu/shared';
import { must } from '../lib/must';
import { requestContext } from '../lib/request-context';
import { successEnvelope } from '../lib/response';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

// Port of apps/api's IntakeController (`intake`, @Roles(PATIENT)).
export const intake = new Hono<AppEnv>();

intake.post(
  '/assessments',
  rateLimit('RATE_LIMITER_INTAKE_SUBMIT'),
  requireAuth(),
  requireRole(UserRole.PATIENT),
  async (c) => {
    const dto = submitIntakeSchema.parse(await c.req.json().catch(() => ({})));
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).intake.submit(userId, dto, requestContext(c));
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

intake.get(
  '/me',
  rateLimit('RATE_LIMITER_INTAKE_LATEST'),
  requireAuth(),
  requireRole(UserRole.PATIENT),
  async (c) => {
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).intake.getLatest(userId);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

intake.get(
  '/history',
  rateLimit('RATE_LIMITER_INTAKE_HISTORY'),
  requireAuth(),
  requireRole(UserRole.PATIENT),
  async (c) => {
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).intake.history(userId);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

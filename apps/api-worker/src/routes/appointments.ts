import { Hono } from 'hono';
import {
  UserRole,
  cancelAppointmentSchema,
  createAppointmentSchema,
  uuidSchema,
} from '@suluhu/shared';
import { z } from 'zod';
import { must } from '../lib/must';
import { requestContext } from '../lib/request-context';
import { successEnvelope } from '../lib/response';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

const scopeSchema = z.object({
  scope: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
});

// Port of apps/api's AppointmentsController + SessionsController, both
// mounted under `appointments` (SessionsController nests under
// `appointments/:id/session`).
export const appointments = new Hono<AppEnv>();

appointments.post(
  '/',
  rateLimit('RATE_LIMITER_APPOINTMENTS_CREATE'),
  requireAuth(),
  requireRole(UserRole.PATIENT),
  async (c) => {
    const dto = createAppointmentSchema.parse(await c.req.json().catch(() => ({})));
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).appointments.create(userId, dto, requestContext(c));
    return c.json(successEnvelope(result, c.get('requestId')), 201);
  },
);

appointments.get('/', rateLimit('RATE_LIMITER_APPOINTMENTS_LIST'), requireAuth(), async (c) => {
  const query = scopeSchema.parse(c.req.query());
  const user = must(c.get('user'));
  const result = await must(c.get('ctx')).appointments.list(user.id, user.role, query.scope);
  return c.json(successEnvelope(result, c.get('requestId')));
});

appointments.get(
  '/:id',
  rateLimit('RATE_LIMITER_APPOINTMENTS_DETAIL'),
  requireAuth(),
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).appointments.getOne(id, userId);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

appointments.post(
  '/:id/cancel',
  rateLimit('RATE_LIMITER_APPOINTMENTS_CANCEL'),
  requireAuth(),
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const dto = cancelAppointmentSchema.parse(await c.req.json().catch(() => ({})));
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).appointments.cancel(
      id,
      userId,
      dto.reason,
      requestContext(c),
    );
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

// --- Video session access/lifecycle --------------------------------------
// Port of SessionsController (`appointments/:id/session`).

appointments.get(
  '/:id/session',
  rateLimit('RATE_LIMITER_SESSIONS_ACCESS'),
  requireAuth(),
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const user = must(c.get('user'));
    const result = await must(c.get('ctx')).sessions.getAccess(id, user);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

appointments.post(
  '/:id/session/start',
  rateLimit('RATE_LIMITER_SESSIONS_START'),
  requireAuth(),
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const user = must(c.get('user'));
    const result = await must(c.get('ctx')).sessions.start(id, user, requestContext(c));
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

appointments.post(
  '/:id/session/end',
  rateLimit('RATE_LIMITER_SESSIONS_END'),
  requireAuth(),
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const user = must(c.get('user'));
    const result = await must(c.get('ctx')).sessions.end(id, user, requestContext(c));
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

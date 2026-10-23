import { Hono } from 'hono';
import {
  TherapistVerificationStatus,
  UserRole,
  paginationQuerySchema,
  reviewDecisionSchema,
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

export const admin = new Hono<AppEnv>();

// Every route here needs the same (ADMIN | SUPER_ADMIN) role, but each still
// gets its own rate-limit tier run *first* — see routes/auth.ts for why
// per-route middleware chains, not a blanket `.use()`, keep the same
// throttle -> authenticate -> authorize order apps/api's guards run in
// (a blanket `.use('*', requireAuth(), requireRole(...))` would run before
// each route's own `rateLimit(...)`, reversing that order).
const requireAdmin = [requireAuth(), requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)] as const;

// --- Therapist onboarding/approval ---------------------------------------
// Port of AdminTherapistsController (`admin/therapists`).

const therapistsListQuerySchema = paginationQuerySchema.extend({
  status: z.nativeEnum(TherapistVerificationStatus).optional(),
});

admin.get(
  '/therapists/applications',
  rateLimit('RATE_LIMITER_ADMIN_THERAPISTS_LIST'),
  ...requireAdmin,
  async (c) => {
    const query = therapistsListQuerySchema.parse(c.req.query());
    const result = await must(c.get('ctx')).adminTherapists.listApplications(query);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

admin.get(
  '/therapists/applications/:id',
  rateLimit('RATE_LIMITER_ADMIN_THERAPISTS_DETAIL'),
  ...requireAdmin,
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const result = await must(c.get('ctx')).adminTherapists.getApplication(id);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

admin.post(
  '/therapists/applications/:id/review',
  rateLimit('RATE_LIMITER_ADMIN_THERAPISTS_REVIEW'),
  ...requireAdmin,
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const dto = reviewDecisionSchema.parse(await c.req.json().catch(() => ({})));
    const adminId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).adminTherapists.review(
      adminId,
      id,
      dto,
      requestContext(c),
    );
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

// --- Clinical alerts -------------------------------------------------------
// Port of AdminAlertsController (`admin/clinical-alerts`).

const alertsListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
});
const resolveSchema = z.object({ note: z.string().trim().max(1000).optional() });

admin.get(
  '/clinical-alerts',
  rateLimit('RATE_LIMITER_ADMIN_ALERTS_LIST'),
  ...requireAdmin,
  async (c) => {
    const query = alertsListQuerySchema.parse(c.req.query());
    const result = await must(c.get('ctx')).adminAlerts.list(query);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

admin.get(
  '/clinical-alerts/count',
  rateLimit('RATE_LIMITER_ADMIN_ALERTS_COUNT'),
  ...requireAdmin,
  async (c) => {
    const result = await must(c.get('ctx')).adminAlerts.countOpen();
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

admin.post(
  '/clinical-alerts/:id/acknowledge',
  rateLimit('RATE_LIMITER_ADMIN_ALERTS_ACKNOWLEDGE'),
  ...requireAdmin,
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const adminId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).adminAlerts.acknowledge(adminId, id, requestContext(c));
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

admin.post(
  '/clinical-alerts/:id/resolve',
  rateLimit('RATE_LIMITER_ADMIN_ALERTS_RESOLVE'),
  ...requireAdmin,
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const dto = resolveSchema.parse(await c.req.json().catch(() => ({})));
    const adminId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).adminAlerts.resolve(
      adminId,
      id,
      dto.note,
      requestContext(c),
    );
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

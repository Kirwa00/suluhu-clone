import { Hono } from 'hono';
import {
  TherapistVerificationStatus,
  UserRole,
  adminUpdateSessionRateSchema,
  contentResourceSchema,
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

admin.patch(
  '/therapists/applications/:id/rate',
  rateLimit('RATE_LIMITER_ADMIN_THERAPISTS_RATE'),
  ...requireAdmin,
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const dto = adminUpdateSessionRateSchema.parse(await c.req.json().catch(() => ({})));
    const adminId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).adminTherapists.updateSessionRate(
      adminId,
      id,
      dto.sessionRateKsh,
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

// --- Psychoeducation content administration -------------------------------
// Port of ContentController's admin routes (`admin/content*`).

admin.get('/content', rateLimit('RATE_LIMITER_ADMIN_CONTENT_LIST'), ...requireAdmin, async (c) => {
  const result = await must(c.get('ctx')).content.adminList();
  return c.json(successEnvelope(result, c.get('requestId')));
});

admin.post(
  '/content',
  rateLimit('RATE_LIMITER_ADMIN_CONTENT_CREATE'),
  ...requireAdmin,
  async (c) => {
    const dto = contentResourceSchema.parse(await c.req.json().catch(() => ({})));
    const adminId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).content.create(adminId, dto);
    return c.json(successEnvelope(result, c.get('requestId')), 201);
  },
);

admin.patch(
  '/content/:id',
  rateLimit('RATE_LIMITER_ADMIN_CONTENT_UPDATE'),
  ...requireAdmin,
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const dto = contentResourceSchema.parse(await c.req.json().catch(() => ({})));
    const result = await must(c.get('ctx')).content.update(id, dto);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

// --- Analytics, revenue, payouts, audit log ---------------------------------
// Port of AdminAnalyticsController (`admin`).

admin.get(
  '/reminders/stats',
  rateLimit('RATE_LIMITER_ADMIN_REMINDERS_STATS'),
  ...requireAdmin,
  async (c) => {
    const result = await must(c.get('ctx')).reminders.stats();
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

admin.get('/metrics', rateLimit('RATE_LIMITER_ADMIN_METRICS'), ...requireAdmin, async (c) => {
  const result = await must(c.get('ctx')).analytics.adminMetrics();
  return c.json(successEnvelope(result, c.get('requestId')));
});

admin.get('/revenue', rateLimit('RATE_LIMITER_ADMIN_REVENUE'), ...requireAdmin, async (c) => {
  const result = await must(c.get('ctx')).analytics.revenueByTherapist();
  return c.json(successEnvelope(result, c.get('requestId')));
});

admin.get('/payouts', rateLimit('RATE_LIMITER_ADMIN_PAYOUTS_LIST'), ...requireAdmin, async (c) => {
  const result = await must(c.get('ctx')).analytics.payoutQueue();
  return c.json(successEnvelope(result, c.get('requestId')));
});

admin.post(
  '/payouts/:therapistId/pay',
  rateLimit('RATE_LIMITER_ADMIN_PAYOUTS_PAY'),
  ...requireAdmin,
  async (c) => {
    const therapistId = uuidSchema.parse(c.req.param('therapistId'));
    const adminId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).analytics.payTherapist(
      adminId,
      therapistId,
      requestContext(c),
    );
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

const auditQuerySchema = paginationQuerySchema.extend({ action: z.string().trim().optional() });

admin.get('/audit-log', rateLimit('RATE_LIMITER_ADMIN_AUDIT_LOG'), ...requireAdmin, async (c) => {
  const query = auditQuerySchema.parse(c.req.query());
  const result = await must(c.get('ctx')).analytics.auditLog(query);
  return c.json(successEnvelope(result, c.get('requestId')));
});

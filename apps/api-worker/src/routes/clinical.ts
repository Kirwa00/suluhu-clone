import { Hono } from 'hono';
import {
  UserRole,
  aiDraftRequestSchema,
  soapNoteSchema,
  treatmentPlanSchema,
  uuidSchema,
} from '@suluhu/shared';
import { must } from '../lib/must';
import { requestContext } from '../lib/request-context';
import { successEnvelope } from '../lib/response';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

// Port of apps/api's ClinicalController, mounted at root (its own routes
// span several unrelated prefixes: clinical-notes, treatment-plans,
// patients, clinical).
export const clinical = new Hono<AppEnv>();

// --- SOAP notes (therapist authors) ---------------------------------------

clinical.post(
  '/clinical-notes',
  rateLimit('RATE_LIMITER_CLINICAL_NOTES_UPSERT'),
  requireAuth(),
  requireRole(UserRole.THERAPIST),
  async (c) => {
    const dto = soapNoteSchema.parse(await c.req.json().catch(() => ({})));
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).clinicalNotes.upsert(userId, dto, requestContext(c));
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

clinical.post(
  '/clinical-notes/ai-draft',
  rateLimit('RATE_LIMITER_CLINICAL_NOTES_AI_DRAFT'),
  requireAuth(),
  requireRole(UserRole.THERAPIST),
  async (c) => {
    const dto = aiDraftRequestSchema.parse(await c.req.json().catch(() => ({})));
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).clinicalNotes.draftAi(userId, dto);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

clinical.get(
  '/clinical-notes/appointment/:appointmentId',
  rateLimit('RATE_LIMITER_CLINICAL_NOTES_BY_APPOINTMENT'),
  requireAuth(),
  async (c) => {
    const appointmentId = uuidSchema.parse(c.req.param('appointmentId'));
    const user = must(c.get('user'));
    const result = await must(c.get('ctx')).clinicalNotes.getByAppointment(
      appointmentId,
      user,
      requestContext(c),
    );
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

// --- Treatment plans -------------------------------------------------------

clinical.post(
  '/treatment-plans',
  rateLimit('RATE_LIMITER_TREATMENT_PLANS_UPSERT'),
  requireAuth(),
  requireRole(UserRole.THERAPIST),
  async (c) => {
    const dto = treatmentPlanSchema.parse(await c.req.json().catch(() => ({})));
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).treatmentPlans.upsert(userId, dto, requestContext(c));
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

// --- Patient record (ABAC) -------------------------------------------------

clinical.get(
  '/patients/:patientId/notes',
  rateLimit('RATE_LIMITER_PATIENTS_NOTES'),
  requireAuth(),
  async (c) => {
    const patientId = uuidSchema.parse(c.req.param('patientId'));
    const user = must(c.get('user'));
    const result = await must(c.get('ctx')).clinicalNotes.listForPatient(patientId, user);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

clinical.get(
  '/patients/:patientId/treatment-plan',
  rateLimit('RATE_LIMITER_PATIENTS_TREATMENT_PLAN'),
  requireAuth(),
  async (c) => {
    const patientId = uuidSchema.parse(c.req.param('patientId'));
    const user = must(c.get('user'));
    const result = await must(c.get('ctx')).treatmentPlans.getForPatient(patientId, user);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

clinical.get(
  '/patients/:patientId/health-record',
  rateLimit('RATE_LIMITER_PATIENTS_HEALTH_RECORD'),
  requireAuth(),
  async (c) => {
    const patientId = uuidSchema.parse(c.req.param('patientId'));
    const user = must(c.get('user'));
    const result = await must(c.get('ctx')).healthRecord.getRecord(
      patientId,
      user,
      requestContext(c),
    );
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

// --- Therapist caseload -----------------------------------------------------

clinical.get(
  '/clinical/clients',
  rateLimit('RATE_LIMITER_CLINICAL_CLIENTS'),
  requireAuth(),
  requireRole(UserRole.THERAPIST),
  async (c) => {
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).healthRecord.listClients(userId);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

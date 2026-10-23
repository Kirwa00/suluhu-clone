import { Hono } from 'hono';
import {
  UserRole,
  setAvailabilitySchema,
  submitCredentialsSchema,
  therapistSearchSchema,
  uploadDocumentSchema,
  uuidSchema,
  type CredentialDocumentType,
} from '@suluhu/shared';
import { AppException } from '../lib/app-exception';
import { must } from '../lib/must';
import { requestContext } from '../lib/request-context';
import { successEnvelope } from '../lib/response';
import { requireAuth } from '../middleware/require-auth';
import { requireRole } from '../middleware/require-role';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

// Port of apps/api's TherapistsController upload constraints
// (therapists/therapists.controller.ts).
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_DOCUMENT_MIME = /^(application\/pdf|image\/(jpeg|png))$/;

export const therapists = new Hono<AppEnv>();

// --- Self-service onboarding (THERAPIST role only) -----------------------
// Port of TherapistsController (`therapists/me`, @Roles(THERAPIST)).

therapists.post(
  '/me/credentials',
  rateLimit('RATE_LIMITER_THERAPISTS_CREDENTIALS'),
  requireAuth(),
  requireRole(UserRole.THERAPIST),
  async (c) => {
    const dto = submitCredentialsSchema.parse(await c.req.json().catch(() => ({})));
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).therapists.submitCredentials(
      userId,
      dto,
      requestContext(c),
    );
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

therapists.get(
  '/me/onboarding',
  rateLimit('RATE_LIMITER_THERAPISTS_ONBOARDING'),
  requireAuth(),
  requireRole(UserRole.THERAPIST),
  async (c) => {
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).therapists.getOnboardingStatus(userId);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

therapists.get(
  '/me/availability',
  rateLimit('RATE_LIMITER_THERAPISTS_AVAILABILITY_GET'),
  requireAuth(),
  requireRole(UserRole.THERAPIST),
  async (c) => {
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).therapists.getAvailability(userId);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

therapists.put(
  '/me/availability',
  rateLimit('RATE_LIMITER_THERAPISTS_AVAILABILITY_PUT'),
  requireAuth(),
  requireRole(UserRole.THERAPIST),
  async (c) => {
    const dto = setAvailabilitySchema.parse(await c.req.json().catch(() => ({})));
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).therapists.setAvailability(
      userId,
      dto,
      requestContext(c),
    );
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

therapists.post(
  '/me/documents',
  rateLimit('RATE_LIMITER_THERAPISTS_DOCUMENTS_UPLOAD'),
  requireAuth(),
  requireRole(UserRole.THERAPIST),
  async (c) => {
    const form = await c.req.formData().catch(() => {
      throw AppException.badRequest('Expected multipart/form-data with a `file` field');
    });
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw AppException.badRequest('A `file` field is required');
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw AppException.badRequest(`File exceeds the ${MAX_DOCUMENT_BYTES} byte limit`);
    }
    if (!ALLOWED_DOCUMENT_MIME.test(file.type)) {
      throw AppException.badRequest('Only PDF, JPEG, and PNG files are accepted');
    }
    const dto = uploadDocumentSchema.parse({ type: form.get('type') });

    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).therapistDocuments.upload(
      userId,
      dto.type as CredentialDocumentType,
      { originalname: file.name, bytes: await file.arrayBuffer(), contentType: file.type },
      requestContext(c),
    );
    return c.json(successEnvelope(result, c.get('requestId')), 201);
  },
);

therapists.get(
  '/me/documents',
  rateLimit('RATE_LIMITER_THERAPISTS_DOCUMENTS_LIST'),
  requireAuth(),
  requireRole(UserRole.THERAPIST),
  async (c) => {
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).therapistDocuments.listMine(userId);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

// --- Document download (owner therapist or admin) ------------------------
// Port of TherapistDocumentsController (`therapists/documents`).

therapists.get(
  '/documents/:id/download',
  rateLimit('RATE_LIMITER_THERAPISTS_DOCUMENT_DOWNLOAD'),
  requireAuth(),
  requireRole(UserRole.THERAPIST, UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (c) => {
    const id = uuidSchema.parse(c.req.param('id'));
    const requester = must(c.get('user'));
    const { bytes, mimeType, filename } = await must(c.get('ctx')).therapistDocuments.download(
      id,
      requester,
      requestContext(c),
    );
    c.header('Content-Type', mimeType);
    c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    return c.body(bytes);
  },
);

// --- Public discovery (any authenticated role) ---------------------------
// Port of DiscoveryController (`therapists`, no @Roles — still behind the
// global JwtAuthGuard, just no role restriction).

therapists.get('/', rateLimit('RATE_LIMITER_THERAPISTS_SEARCH'), requireAuth(), async (c) => {
  const query = therapistSearchSchema.parse(c.req.query());
  const result = await must(c.get('ctx')).discovery.search(query);
  return c.json(successEnvelope(result, c.get('requestId')));
});

therapists.get('/:id', rateLimit('RATE_LIMITER_THERAPISTS_DETAIL'), requireAuth(), async (c) => {
  const id = uuidSchema.parse(c.req.param('id'));
  const result = await must(c.get('ctx')).discovery.getPublicProfile(id);
  return c.json(successEnvelope(result, c.get('requestId')));
});

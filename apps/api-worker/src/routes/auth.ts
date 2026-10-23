import { Hono } from 'hono';
import {
  OTP_LENGTH,
  changePasswordSchema,
  googleLoginSchema,
  googleRegisterSchema,
  loginSchema,
  registerSchema,
  requestOtpSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyMfaSchema,
  verifyOtpSchema,
} from '@suluhu/shared';
import { AppException } from '../lib/app-exception';
import { must } from '../lib/must';
import { requestContext } from '../lib/request-context';
import { successEnvelope } from '../lib/response';
import { requireAuth } from '../middleware/require-auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

export const auth = new Hono<AppEnv>();

/** Reads and zod-parses the JSON body; validation errors flow to app.onError like Nest's ZodValidationPipe. */
async function body<T>(c: { req: { json(): Promise<unknown> } }, schema: { parse(v: unknown): T }) {
  return schema.parse(await c.req.json().catch(() => ({})));
}

auth.post('/register', rateLimit('RATE_LIMITER_AUTH_REGISTER'), async (c) => {
  const dto = await body(c, registerSchema);
  const result = await must(c.get('ctx')).auth.register(dto, requestContext(c));
  return c.json(successEnvelope(result, c.get('requestId')), 201);
});

auth.post('/login', rateLimit('RATE_LIMITER_AUTH_LOGIN'), async (c) => {
  const dto = await body(c, loginSchema);
  const result = await must(c.get('ctx')).auth.login(dto, requestContext(c));
  return c.json(successEnvelope(result, c.get('requestId')));
});

auth.post('/google', rateLimit('RATE_LIMITER_AUTH_GOOGLE'), async (c) => {
  const dto = await body(c, googleLoginSchema);
  const result = await must(c.get('ctx')).auth.loginWithGoogle(dto.credential, requestContext(c));
  return c.json(successEnvelope(result, c.get('requestId')));
});

auth.post('/google/register', rateLimit('RATE_LIMITER_AUTH_GOOGLE_REGISTER'), async (c) => {
  const dto = await body(c, googleRegisterSchema);
  const result = await must(c.get('ctx')).auth.registerWithGoogle(dto, requestContext(c));
  return c.json(successEnvelope(result, c.get('requestId')), 201);
});

auth.post('/mfa/verify', rateLimit('RATE_LIMITER_AUTH_MFA_VERIFY'), async (c) => {
  const dto = await body(c, verifyMfaSchema);
  const result = await must(c.get('ctx')).auth.verifyMfa(dto.mfaToken, dto.code, requestContext(c));
  return c.json(successEnvelope(result, c.get('requestId')));
});

// Called on page loads to restore the session; the strict class limit logged users out.
auth.post('/refresh', rateLimit('RATE_LIMITER_AUTH_REFRESH'), async (c) => {
  const payload = (await c.req.json().catch(() => ({}))) as { refreshToken?: unknown };
  if (typeof payload.refreshToken !== 'string') {
    throw AppException.unauthorized('Invalid refresh token');
  }
  const result = await must(c.get('ctx')).auth.refresh(payload.refreshToken, requestContext(c));
  return c.json(successEnvelope(result, c.get('requestId')));
});

auth.post('/logout', rateLimit('RATE_LIMITER_AUTH_LOGOUT'), requireAuth(), async (c) => {
  const payload = (await c.req.json().catch(() => ({}))) as { refreshToken?: unknown };
  const refreshToken = typeof payload.refreshToken === 'string' ? payload.refreshToken : undefined;
  await must(c.get('ctx')).auth.logout(refreshToken, c.get('authJti'));
  return c.json(successEnvelope({ success: true }, c.get('requestId')));
});

auth.post('/otp/request', rateLimit('RATE_LIMITER_AUTH_OTP_REQUEST'), requireAuth(), async (c) => {
  const dto = await body(c, requestOtpSchema);
  const userId = must(c.get('user')).id;
  await must(c.get('ctx')).auth.requestOtp(userId, dto.purpose);
  return c.json(successEnvelope({ sent: true }, c.get('requestId')));
});

auth.post('/otp/verify', rateLimit('RATE_LIMITER_AUTH_OTP_VERIFY'), requireAuth(), async (c) => {
  const dto = await body(c, verifyOtpSchema);
  const userId = must(c.get('user')).id;
  const result = await must(c.get('ctx')).auth.verifyOtp(
    userId,
    dto.purpose,
    dto.code,
    requestContext(c),
  );
  return c.json(successEnvelope(result, c.get('requestId')));
});

auth.post('/password/forgot', rateLimit('RATE_LIMITER_AUTH_PASSWORD_FORGOT'), async (c) => {
  const dto = await body(c, requestPasswordResetSchema);
  await must(c.get('ctx')).auth.requestPasswordReset(dto.email);
  return c.json(successEnvelope({ sent: true }, c.get('requestId')));
});

auth.post('/password/reset', rateLimit('RATE_LIMITER_AUTH_PASSWORD_RESET'), async (c) => {
  const dto = await body(c, resetPasswordSchema);
  await must(c.get('ctx')).auth.resetPassword(dto.email, dto.code, dto.password, requestContext(c));
  return c.json(successEnvelope({ reset: true }, c.get('requestId')));
});

auth.post(
  '/password/change',
  rateLimit('RATE_LIMITER_AUTH_PASSWORD_CHANGE'),
  requireAuth(),
  async (c) => {
    const dto = await body(c, changePasswordSchema);
    const userId = must(c.get('user')).id;
    await must(c.get('ctx')).auth.changePassword(userId, dto, requestContext(c));
    return c.json(successEnvelope({ changed: true }, c.get('requestId')));
  },
);

auth.get('/me', rateLimit('RATE_LIMITER_AUTH_ME'), requireAuth(), (c) => {
  return c.json(successEnvelope(must(c.get('user')), c.get('requestId')));
});

/**
 * Test-only: retrieves the OTP code last sent to `to` via a mock provider, so
 * E2E tests can complete MFA/verification flows without a real SMS/email
 * provider — port of AuthController's `GET /auth/test/otp`.
 *
 * apps/api additionally 404s this unless `NODE_ENV==='test'`, so it "never
 * exists outside CI/test runs" even in plain local dev. There's no Workers
 * equivalent of NODE_ENV to key that off of, and it's redundant with the
 * real safety boundary below: `getLastMockMessage` only returns a value when
 * the configured provider actually is the mock one, and a live provider
 * never retains message content — so in any environment actually running
 * live providers this already safely 404s. Deliberately not reproducing the
 * extra NODE_ENV gate; see the Phase 2 PR description.
 */
auth.get('/test/otp', rateLimit('RATE_LIMITER_AUTH_TEST_OTP'), (c) => {
  const to = c.req.query('to');
  const message = to ? must(c.get('ctx')).notifications.getLastMockMessage(to) : undefined;
  const match = message?.match(new RegExp(`is (\\d{${OTP_LENGTH}})\\.`));
  if (!match) {
    throw AppException.notFound('No code found for this recipient');
  }
  return c.json(successEnvelope({ code: match[1] }, c.get('requestId')));
});

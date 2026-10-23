import { Hono } from 'hono';
import { uuidSchema } from '@suluhu/shared';
import { must } from '../lib/must';
import { successEnvelope } from '../lib/response';
import { requireAuth } from '../middleware/require-auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

// Port of apps/api's PaymentsController (`payments`).
export const payments = new Hono<AppEnv>();

/** Safaricom Daraja STK callback (public webhook, direct-Daraja integrations only). */
payments.post('/mpesa/callback', rateLimit('RATE_LIMITER_PAYMENTS_MPESA_CALLBACK'), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  await must(c.get('ctx')).payments.handleDarajaCallback(body);
  // Daraja expects this acknowledgement shape.
  return c.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

/** PayHero STK callback (public webhook) — see MPESA_CALLBACK_URL. */
payments.post(
  '/payhero/callback',
  rateLimit('RATE_LIMITER_PAYMENTS_PAYHERO_CALLBACK'),
  async (c) => {
    const body = await c.req.json().catch(() => ({}));
    await must(c.get('ctx')).payments.handlePayHeroCallback(body);
    return c.json({ success: true });
  },
);

payments.get(
  '/appointment/:appointmentId',
  rateLimit('RATE_LIMITER_PAYMENTS_STATUS'),
  requireAuth(),
  async (c) => {
    const appointmentId = uuidSchema.parse(c.req.param('appointmentId'));
    const userId = must(c.get('user')).id;
    const result = await must(c.get('ctx')).payments.getStatusForUser(appointmentId, userId);
    return c.json(successEnvelope(result, c.get('requestId')));
  },
);

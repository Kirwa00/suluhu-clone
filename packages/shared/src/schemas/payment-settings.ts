import { z } from 'zod';

/**
 * Admin update to the PayHero/M-Pesa integration config (see
 * apps/api-worker/src/lib/payment-settings-service.ts). Every field is
 * optional — an admin can flip just the mode, or just rotate the password,
 * without re-submitting everything else.
 */
export const updatePaymentSettingsSchema = z.object({
  mpesaMode: z.enum(['mock', 'live']).optional(),
  payheroApiUsername: z.string().trim().min(1).max(200).optional(),
  payheroApiPassword: z.string().trim().min(1).max(500).optional(),
  payheroChannelId: z.coerce.number().int().positive().optional(),
  payheroBaseUrl: z.string().trim().url().optional(),
  mpesaCallbackUrl: z.string().trim().url().optional(),
});
export type UpdatePaymentSettingsInput = z.infer<typeof updatePaymentSettingsSchema>;

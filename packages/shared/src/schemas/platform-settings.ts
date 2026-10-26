import { z } from 'zod';
import { PLATFORM_COMMISSION_MAX, PLATFORM_COMMISSION_MIN } from '../constants';

/**
 * Admin update to the platform-wide commission rate (see
 * apps/api-worker/src/lib/platform-settings-service.ts). A fraction, not a
 * percentage — 0.25 means 25%. Bounded by the same 20–30% band (§13.1) the
 * rate used to be hardcoded to.
 */
export const updatePlatformCommissionSchema = z.object({
  platformCommissionRate: z.coerce
    .number()
    .min(PLATFORM_COMMISSION_MIN, `Commission must be at least ${PLATFORM_COMMISSION_MIN * 100}%`)
    .max(PLATFORM_COMMISSION_MAX, `Commission must be at most ${PLATFORM_COMMISSION_MAX * 100}%`),
});
export type UpdatePlatformCommissionInput = z.infer<typeof updatePlatformCommissionSchema>;

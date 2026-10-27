import { PLATFORM_COMMISSION_DEFAULT } from '@suluhu/shared';
import type { PrismaClient } from '../generated/prisma';
import type { AuditService } from './audit';
import type { RequestContext } from './types';

/**
 * Admin-managed platform commission rate, stored in a single fixed row
 * instead of the PLATFORM_COMMISSION_DEFAULT constant — so an admin can
 * change the platform-wide cut from the admin area without a code change
 * and redeploy. A fraction (0.25 = 25%), bounded by the
 * PLATFORM_COMMISSION_MIN/MAX band in packages/shared/src/constants.ts.
 */
const SINGLETON_ID = '00000000-0000-0000-0000-000000000001';

export interface PlatformSettingsView {
  platformCommissionRate: number;
  updatedAt: string | null;
}

export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  /**
   * Swallows "table doesn't exist yet" and similar errors instead of
   * throwing — same reasoning as PaymentSettingsService.getRowSafe: this
   * runs on the per-request hot path (getEffectiveRate), so a
   * not-yet-migrated environment falls back to the constant instead of
   * 500ing every request that touches revenue/payouts.
   */
  private async getRowSafe() {
    try {
      return await this.prisma.platformSettings.findUnique({ where: { id: SINGLETON_ID } });
    } catch (err) {
      console.warn('PlatformSettings lookup failed — falling back to the default rate', err);
      return null;
    }
  }

  async get(): Promise<PlatformSettingsView> {
    const row = await this.getRowSafe();
    return {
      platformCommissionRate: row?.platformCommissionRate ?? PLATFORM_COMMISSION_DEFAULT,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  /** Used only by context.ts to resolve the rate AnalyticsService runs with. */
  async getEffectiveRate(): Promise<number> {
    const row = await this.getRowSafe();
    return row?.platformCommissionRate ?? PLATFORM_COMMISSION_DEFAULT;
  }

  async update(
    adminId: string,
    platformCommissionRate: number,
    ctx: RequestContext,
  ): Promise<PlatformSettingsView> {
    const existing = await this.prisma.platformSettings.findUnique({
      where: { id: SINGLETON_ID },
    });

    await this.prisma.platformSettings.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, platformCommissionRate },
      update: { platformCommissionRate },
    });

    await this.audit.record({
      userId: adminId,
      action: 'admin.platform.commission_updated',
      resourceType: 'platform_settings',
      resourceId: SINGLETON_ID,
      ...ctx,
      metadata: {
        previousRate: existing?.platformCommissionRate ?? PLATFORM_COMMISSION_DEFAULT,
        newRate: platformCommissionRate,
      },
    });

    return this.get();
  }
}

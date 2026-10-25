import type { Prisma, PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';
import type { AuditService } from './audit';
import type { PhiCryptoService } from './phi-crypto';
import type { RequestContext } from './types';

/**
 * Admin-managed PayHero/M-Pesa integration config, stored in a single fixed
 * row instead of Worker secrets + wrangler.jsonc — so an admin can switch
 * modes and set/rotate credentials from the admin area without a redeploy.
 *
 * `payheroApiPasswordEnc` is app-layer ciphertext (same AES-256-GCM scheme
 * as PHI fields, via the shared PhiCryptoService) — the plaintext password
 * is never stored, logged, or returned by this service's public API.
 */
const SINGLETON_ID = '00000000-0000-0000-0000-000000000001';

export interface PaymentSettingsView {
  mpesaMode: 'mock' | 'live';
  payheroApiUsername: string | null;
  payheroChannelId: number | null;
  payheroBaseUrl: string | null;
  mpesaCallbackUrl: string | null;
  hasPayheroApiPassword: boolean;
  updatedAt: string | null;
}

export interface UpdatePaymentSettingsInput {
  mpesaMode?: 'mock' | 'live';
  payheroApiUsername?: string;
  /** Plaintext; omit to keep whatever password is already stored. */
  payheroApiPassword?: string;
  payheroChannelId?: number;
  payheroBaseUrl?: string;
  mpesaCallbackUrl?: string;
}

/** What context.ts needs to actually build a provider; env vars fill in any gap. */
export interface EffectivePaymentConfig {
  mode: 'mock' | 'live';
  apiUsername?: string;
  apiPassword?: string;
  channelId?: number;
  baseUrl?: string;
  callbackUrl?: string;
}

export class PaymentSettingsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly phi: PhiCryptoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Swallows "table doesn't exist yet" and similar errors instead of
   * throwing — used on the per-request hot path (getEffectiveConfig) so a
   * not-yet-migrated environment falls back to env vars instead of 500ing
   * every request. The admin-facing `get()` also uses this so the settings
   * page itself doesn't break before the migration has run.
   */
  private async getRowSafe() {
    try {
      return await this.prisma.paymentProviderSettings.findUnique({
        where: { id: SINGLETON_ID },
      });
    } catch (err) {
      console.warn('PaymentProviderSettings lookup failed — falling back to defaults', err);
      return null;
    }
  }

  async get(): Promise<PaymentSettingsView> {
    const row = await this.getRowSafe();
    return {
      mpesaMode: row?.mpesaMode === 'live' ? 'live' : 'mock',
      payheroApiUsername: row?.payheroApiUsername ?? null,
      payheroChannelId: row?.payheroChannelId ?? null,
      payheroBaseUrl: row?.payheroBaseUrl ?? null,
      mpesaCallbackUrl: row?.mpesaCallbackUrl ?? null,
      hasPayheroApiPassword: Boolean(row?.payheroApiPasswordEnc),
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    };
  }

  /** Used only by context.ts to build the real mpesa provider — never exposed over the API. */
  async getEffectiveConfig(envFallback: EffectivePaymentConfig): Promise<EffectivePaymentConfig> {
    const row = await this.getRowSafe();
    if (!row) return envFallback;
    const apiPassword = row.payheroApiPasswordEnc
      ? await this.phi.decrypt(row.payheroApiPasswordEnc)
      : envFallback.apiPassword;
    return {
      mode:
        row.mpesaMode === 'live' ? 'live' : row.mpesaMode === 'mock' ? 'mock' : envFallback.mode,
      apiUsername: row.payheroApiUsername ?? envFallback.apiUsername,
      apiPassword,
      channelId: row.payheroChannelId ?? envFallback.channelId,
      baseUrl: row.payheroBaseUrl ?? envFallback.baseUrl,
      callbackUrl: row.mpesaCallbackUrl ?? envFallback.callbackUrl,
    };
  }

  async update(
    adminId: string,
    input: UpdatePaymentSettingsInput,
    ctx: RequestContext,
  ): Promise<PaymentSettingsView> {
    const existing = await this.prisma.paymentProviderSettings.findUnique({
      where: { id: SINGLETON_ID },
    });

    const nextMode = input.mpesaMode ?? (existing?.mpesaMode === 'live' ? 'live' : 'mock');
    const nextUsername = input.payheroApiUsername ?? existing?.payheroApiUsername ?? null;
    const nextChannelId = input.payheroChannelId ?? existing?.payheroChannelId ?? null;
    const nextCallbackUrl = input.mpesaCallbackUrl ?? existing?.mpesaCallbackUrl ?? null;
    const willHavePassword =
      Boolean(input.payheroApiPassword) || Boolean(existing?.payheroApiPasswordEnc);

    if (nextMode === 'live') {
      const missing: string[] = [];
      if (!nextUsername) missing.push('payheroApiUsername');
      if (!willHavePassword) missing.push('payheroApiPassword');
      if (!nextChannelId) missing.push('payheroChannelId');
      if (!nextCallbackUrl) missing.push('mpesaCallbackUrl');
      if (missing.length > 0) {
        throw AppException.badRequest(
          `Cannot switch to live mode — missing: ${missing.join(', ')}`,
        );
      }
    }

    const data: Prisma.PaymentProviderSettingsCreateInput = {
      id: SINGLETON_ID,
      mpesaMode: nextMode,
      payheroApiUsername: input.payheroApiUsername ?? existing?.payheroApiUsername,
      payheroApiPasswordEnc: input.payheroApiPassword
        ? await this.phi.encrypt(input.payheroApiPassword)
        : existing?.payheroApiPasswordEnc,
      payheroChannelId: input.payheroChannelId ?? existing?.payheroChannelId,
      payheroBaseUrl: input.payheroBaseUrl ?? existing?.payheroBaseUrl,
      mpesaCallbackUrl: input.mpesaCallbackUrl ?? existing?.mpesaCallbackUrl,
    };

    await this.prisma.paymentProviderSettings.upsert({
      where: { id: SINGLETON_ID },
      create: data,
      update: data,
    });

    await this.audit.record({
      userId: adminId,
      action: 'admin.payments.settings_updated',
      resourceType: 'payment_provider_settings',
      resourceId: SINGLETON_ID,
      ...ctx,
      metadata: {
        mpesaMode: nextMode,
        usernameChanged: input.payheroApiUsername !== undefined,
        passwordChanged: Boolean(input.payheroApiPassword),
        channelIdChanged: input.payheroChannelId !== undefined,
        baseUrlChanged: input.payheroBaseUrl !== undefined,
        callbackUrlChanged: input.mpesaCallbackUrl !== undefined,
      },
    });

    return this.get();
  }
}

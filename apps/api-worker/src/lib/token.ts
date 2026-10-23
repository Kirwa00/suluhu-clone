import { jwtVerify, SignJWT } from 'jose';
import { ErrorCode, type AuthTokens, type AuthUser } from '@suluhu/shared';
import type { PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';
import { randomTokenBase64Url, sha256Hex } from './crypto';
import type { RequestContext } from './types';

const ACCESS_BLOCKLIST_PREFIX = 'access:';

/** JWT access-token payload — same shape as apps/api's AccessTokenPayload. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: AuthUser['role'];
  status: string;
  mfaEnabled: boolean;
  jti: string;
}

/** Short-lived token issued between password check and MFA verification. */
export interface MfaChallengePayload {
  sub: string;
  purpose: 'mfa';
  jti: string;
}

export function toAuthUser(user: {
  id: string;
  email: string;
  role: AuthUser['role'];
  status: string;
  mfaEnabled: boolean;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    mfaEnabled: user.mfaEnabled,
  };
}

/** Parses durations like `15m`, `7d`, `30s`, `2h` into seconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) return asNumber;
    throw new Error(`Invalid duration: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] as string;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return amount * (multipliers[unit] ?? 1);
}

/**
 * Issues and validates JWT access tokens and opaque, rotating refresh tokens
 * — port of apps/api/src/modules/auth/services/token.service.ts using `jose`
 * instead of `@nestjs/jwt`/`jsonwebtoken` (same HS256 algorithm, same
 * secrets, claims, and expiries) and a KV-backed access-token blocklist
 * instead of Redis (same fail-open posture on a lookup/write error).
 */
export class TokenService {
  private readonly accessSecret: Uint8Array;
  private readonly accessTtl: string;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly kv: KVNamespace,
    // `refreshTtl` only — like apps/api's TokenService, there's no
    // `refreshSecret` parameter: refresh tokens are opaque, DB-looked-up
    // values, never JWT-signed, so JWT_REFRESH_SECRET (still required by env
    // validation, for parity) has no consumer here either.
    config: { accessSecret: string; accessTtl: string; refreshTtl: string },
  ) {
    this.accessSecret = new TextEncoder().encode(config.accessSecret);
    this.accessTtl = config.accessTtl;
    this.accessTtlSeconds = parseDuration(config.accessTtl);
    this.refreshTtlMs = parseDuration(config.refreshTtl) * 1000;
  }

  async issueTokens(user: AuthUser, ctx: RequestContext): Promise<AuthTokens> {
    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id, crypto.randomUUID(), ctx);
    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds };
  }

  async signAccessToken(user: AuthUser): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      mfaEnabled: user.mfaEnabled,
      jti: crypto.randomUUID(),
    };
    return new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(this.accessTtl)
      .sign(this.accessSecret);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    let payload: AccessTokenPayload;
    try {
      const result = await jwtVerify<AccessTokenPayload>(token, this.accessSecret);
      payload = result.payload;
    } catch {
      throw AppException.unauthorized('Session expired or invalid', ErrorCode.AUTH_TOKEN_EXPIRED);
    }

    // SECURITY/AVAILABILITY DECISION (same as apps/api): access-token
    // revocation is backed by KV, but KV availability must not become a hard
    // dependency for every authenticated request. Access tokens have a short
    // (~15 minute) TTL, so if KV is temporarily unavailable we fail open and
    // rely on JWT expiration.
    if (await this.isAccessRevokedFailOpen(payload.jti)) {
      throw AppException.unauthorized('Session has been revoked', ErrorCode.AUTH_TOKEN_INVALID);
    }
    return payload;
  }

  /** Issues a short-lived (5-min) MFA challenge token after a valid password. */
  async signMfaChallenge(userId: string): Promise<string> {
    const payload: MfaChallengePayload = { sub: userId, purpose: 'mfa', jti: crypto.randomUUID() };
    return new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.accessSecret);
  }

  async verifyMfaChallenge(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify<MfaChallengePayload>(token, this.accessSecret);
      if (payload.purpose !== 'mfa') throw new Error('wrong purpose');
      return payload.sub as string;
    } catch {
      throw AppException.unauthorized(
        'MFA session expired, please log in again',
        ErrorCode.AUTH_TOKEN_EXPIRED,
      );
    }
  }

  /**
   * Rotates a refresh token: validates the presented token, revokes it, and
   * issues a fresh one in the same family. Detects reuse of an
   * already-revoked token and revokes the entire family as a precaution.
   */
  async rotateRefreshToken(
    rawToken: string,
    ctx: RequestContext,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const tokenHash = await sha256Hex(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) {
      throw AppException.unauthorized('Invalid refresh token', ErrorCode.AUTH_TOKEN_INVALID);
    }

    if (existing.revokedAt || existing.expiresAt < new Date()) {
      // Reuse of a revoked/expired token → revoke the whole lineage.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw AppException.unauthorized('Refresh token reuse detected', ErrorCode.AUTH_TOKEN_INVALID);
    }

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    const authUser = toAuthUser(existing.user);
    const accessToken = await this.signAccessToken(authUser);
    const refreshToken = await this.createRefreshToken(existing.userId, existing.familyId, ctx);
    return {
      user: authUser,
      tokens: { accessToken, refreshToken, expiresIn: this.accessTtlSeconds },
    };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = await sha256Hex(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every active session for a user (used on password change/reset). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Adds an access token's jti to the KV blocklist until its natural expiry. */
  async blocklistAccess(jti: string): Promise<void> {
    await this.kv.put(`${ACCESS_BLOCKLIST_PREFIX}${jti}`, '1', {
      expirationTtl: this.accessTtlSeconds,
    });
  }

  /**
   * Checks the KV blocklist for a revoked jti, failing open (treating the
   * token as not-revoked) if KV itself is unavailable rather than rejecting
   * an otherwise valid, unexpired access token.
   */
  private async isAccessRevokedFailOpen(jti: string): Promise<boolean> {
    try {
      const value = await this.kv.get(`${ACCESS_BLOCKLIST_PREFIX}${jti}`);
      return value !== null;
    } catch (err) {
      console.warn(
        `AUTH_KV unavailable — access-token revocation could not be checked; continuing under the fail-open policy (${(err as Error).message})`,
      );
      return false;
    }
  }

  private async createRefreshToken(
    userId: string,
    familyId: string,
    ctx: RequestContext,
  ): Promise<string> {
    const rawToken = randomTokenBase64Url(48);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: await sha256Hex(rawToken),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
      },
    });
    return rawToken;
  }
}

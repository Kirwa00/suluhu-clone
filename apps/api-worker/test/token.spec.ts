import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { TokenService } from '../src/lib/token';
import type { AuthUser } from '@suluhu/shared';

// These exercise only the JWT (jose) and KV-blocklist paths — not the
// refresh-token-rotation paths, which need Prisma/pg (see
// test/health-db.spec.ts for why those aren't covered in this harness).
const NO_PRISMA = null as never;

function makeService(): TokenService {
  return new TokenService(NO_PRISMA, env.AUTH_KV, {
    accessSecret: 'a'.repeat(32),
    accessTtl: '15m',
    refreshTtl: '7d',
  });
}

const USER: AuthUser = {
  id: 'user-1',
  email: 'patient@example.com',
  role: 'PATIENT',
  status: 'ACTIVE',
  mfaEnabled: true,
};

describe('TokenService', () => {
  it('signs and verifies an access token round-trip', async () => {
    const service = makeService();
    const token = await service.signAccessToken(USER);
    const payload = await service.verifyAccessToken(token);
    expect(payload.sub).toBe(USER.id);
    expect(payload.email).toBe(USER.email);
    expect(payload.role).toBe(USER.role);
    expect(payload.mfaEnabled).toBe(true);
    expect(payload.jti).toBeTruthy();
  });

  it('rejects an access token signed with a different secret', async () => {
    const a = makeService();
    const b = new TokenService(NO_PRISMA, env.AUTH_KV, {
      accessSecret: 'b'.repeat(32),
      accessTtl: '15m',
      refreshTtl: '7d',
    });
    const token = await a.signAccessToken(USER);
    await expect(b.verifyAccessToken(token)).rejects.toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
  });

  it('signs and verifies an MFA challenge token, rejecting the wrong purpose', async () => {
    const service = makeService();
    const mfaToken = await service.signMfaChallenge(USER.id);
    expect(await service.verifyMfaChallenge(mfaToken)).toBe(USER.id);

    const accessToken = await service.signAccessToken(USER);
    await expect(service.verifyMfaChallenge(accessToken)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_EXPIRED',
    });
  });

  it('blocklists an access token jti and then rejects it as revoked', async () => {
    const service = makeService();
    const token = await service.signAccessToken(USER);
    const { jti } = await service.verifyAccessToken(token);

    await service.blocklistAccess(jti);
    await expect(service.verifyAccessToken(token)).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });
});

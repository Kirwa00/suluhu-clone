import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ErrorCode } from '@suluhu/shared';
import { AppException } from './app-exception';

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface GoogleIdTokenClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  given_name?: string;
  family_name?: string;
}

/**
 * Google's ID-token signing keys. `google-auth-library` (Node-only, can't
 * run on Workers) wraps exactly this: fetch the JWKS, verify the JWT against
 * it. Created once at module scope — it's a public-key cache, not
 * per-request state, and jose's `createRemoteJWKSet` already handles
 * refetch-on-miss/cooldown, so reusing it across requests on a warm isolate
 * avoids re-fetching Google's JWKS on every sign-in.
 */
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/** Verifies Google ID tokens (signature, issuer, expiry, audience = our client ID). */
export class GoogleIdentityService {
  constructor(private readonly clientId: string | undefined) {}

  async verify(credential: string): Promise<VerifiedGoogleIdentity> {
    if (!this.clientId) {
      throw AppException.badRequest('Google sign-in is not enabled', ErrorCode.AUTH_TOKEN_INVALID);
    }

    const invalid = () =>
      AppException.unauthorized('Google sign-in failed. Try again.', ErrorCode.AUTH_TOKEN_INVALID);

    let claims: GoogleIdTokenClaims;
    try {
      const { payload } = await jwtVerify<GoogleIdTokenClaims>(credential, GOOGLE_JWKS, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: this.clientId,
      });
      claims = payload;
    } catch {
      throw invalid();
    }
    if (!claims.sub || !claims.email || claims.email_verified !== true) throw invalid();

    return {
      sub: claims.sub,
      email: claims.email.toLowerCase(),
      firstName: claims.given_name ?? '',
      lastName: claims.family_name ?? '',
    };
  }
}

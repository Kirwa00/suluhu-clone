/**
 * CPB (Counsellors & Psychologists Board) license verification — port of
 * apps/api/src/modules/therapists/providers/cpb-verification.provider.ts.
 *
 * Production would call the CPB portal API to confirm a therapist's
 * registration is valid and current. No such integration exists yet on
 * either backend — this mock validates the documented license format
 * (CPB/YYYY/NNNN) and echoes a deterministic result, same as apps/api's
 * `MockCpbVerificationProvider`, so the onboarding workflow is exercisable
 * identically on both. apps/api additionally warns at boot if
 * `PROVIDER_MODE==='live'` since no live provider exists; the Worker logs the
 * same warning from `createAuthContext` instead (see context.ts).
 */

export interface CpbVerificationRequest {
  licenseNumber: string;
  holderName: string;
}

export interface CpbVerificationResult {
  valid: boolean;
  status: 'ACTIVE' | 'EXPIRED' | 'NOT_FOUND' | 'SUSPENDED';
  licenseNumber: string;
  holderName?: string;
  expiry?: string; // ISO date
  checkedAt: string;
  source: 'mock' | 'cpb-portal';
}

export interface CpbVerificationProvider {
  verify(request: CpbVerificationRequest): Promise<CpbVerificationResult>;
}

const CPB_LICENSE_PATTERN = /^CPB\/\d{4}\/\d{3,5}$/i;

export class MockCpbVerificationProvider implements CpbVerificationProvider {
  async verify(request: CpbVerificationRequest): Promise<CpbVerificationResult> {
    const checkedAt = new Date().toISOString();
    const normalized = request.licenseNumber.trim().toUpperCase();

    if (!CPB_LICENSE_PATTERN.test(normalized)) {
      return {
        valid: false,
        status: 'NOT_FOUND',
        licenseNumber: normalized,
        checkedAt,
        source: 'mock',
      };
    }

    // Deterministic mock: licenses ending in an even digit are ACTIVE.
    const lastDigit = Number(normalized.slice(-1));
    const active = Number.isFinite(lastDigit) ? lastDigit % 2 === 0 : true;
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + (active ? 2 : -1));

    return {
      valid: active,
      status: active ? 'ACTIVE' : 'EXPIRED',
      licenseNumber: normalized,
      holderName: request.holderName,
      expiry: expiry.toISOString().slice(0, 10),
      checkedAt,
      source: 'mock',
    };
  }
}

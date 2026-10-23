import { describe, expect, it } from 'vitest';
import { EnvValidationError, validateEnv } from '../src/env';

const base = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  PHI_ENCRYPTION_KEY: 'c3VsdWh1LWRldi1vbmx5LXBoaS1rZXktMzJieXRlcyE=', // 32 bytes
};

describe('validateEnv', () => {
  it('accepts a minimal valid config and fills in defaults', () => {
    const env = validateEnv(base);
    expect(env.PROVIDER_MODE).toBe('mock');
    expect(env.API_PUBLIC_URL).toBe('https://api.suluhutherapy.com');
    expect(env.JWT_ACCESS_TTL).toBe('15m');
  });

  it('rejects a JWT secret shorter than 32 chars', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      EnvValidationError,
    );
  });

  it('rejects a PHI_ENCRYPTION_KEY that is not a base64-encoded 32-byte key', () => {
    expect(() => validateEnv({ ...base, PHI_ENCRYPTION_KEY: 'not-base64-32-bytes' })).toThrow(
      EnvValidationError,
    );
  });

  it('treats a blank var as absent rather than invalid', () => {
    const env = validateEnv({ ...base, GOOGLE_CLIENT_ID: '' });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('requires PayHero credentials when MPESA_MODE=live', () => {
    expect(() => validateEnv({ ...base, MPESA_MODE: 'live' })).toThrow(/MPESA_MODE=live requires/);
  });

  it('passes when MPESA_MODE=live and all PayHero credentials are present', () => {
    const env = validateEnv({
      ...base,
      MPESA_MODE: 'live',
      MPESA_CALLBACK_URL: 'https://api.suluhutherapy.com/api/v1/payments/payhero/callback',
      PAYHERO_API_USERNAME: 'user',
      PAYHERO_API_PASSWORD: 'pass',
      PAYHERO_CHANNEL_ID: '123',
    });
    expect(env.MPESA_MODE).toBe('live');
  });

  it('requires DAILY_API_KEY and DAILY_DOMAIN when VIDEO_MODE=live', () => {
    expect(() => validateEnv({ ...base, VIDEO_MODE: 'live' })).toThrow(/VIDEO_MODE=live requires/);
  });

  it('requires AT_USERNAME and AT_API_KEY when SMS_MODE=live', () => {
    expect(() => validateEnv({ ...base, SMS_MODE: 'live' })).toThrow(/SMS_MODE=live requires/);
  });

  it('requires RESEND_API_KEY when EMAIL_MODE=live', () => {
    expect(() => validateEnv({ ...base, EMAIL_MODE: 'live' })).toThrow(/EMAIL_MODE=live requires/);
  });
});

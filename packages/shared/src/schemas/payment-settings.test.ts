import { describe, expect, it } from 'vitest';
import { updatePaymentSettingsSchema } from './payment-settings';

describe('updatePaymentSettingsSchema', () => {
  it('accepts an empty object (every field optional)', () => {
    expect(updatePaymentSettingsSchema.parse({})).toEqual({});
  });

  it('accepts a full update and coerces the channel id', () => {
    const parsed = updatePaymentSettingsSchema.parse({
      mpesaMode: 'live',
      payheroApiUsername: 'suluhu',
      payheroApiPassword: 'super-secret',
      payheroChannelId: '1234',
      payheroBaseUrl: 'https://backend.payhero.co.ke',
      mpesaCallbackUrl: 'https://api.suluhutherapy.com/api/v1/payments/payhero/callback',
    });
    expect(parsed.payheroChannelId).toBe(1234);
    expect(parsed.mpesaMode).toBe('live');
  });

  it.each([
    [{ mpesaMode: 'sandbox' }, 'unknown mode'],
    [{ payheroApiUsername: '' }, 'empty username'],
    [{ payheroApiPassword: '' }, 'empty password'],
    [{ payheroChannelId: -1 }, 'non-positive channel id'],
    [{ payheroBaseUrl: 'not-a-url' }, 'invalid base url'],
    [{ mpesaCallbackUrl: 'not-a-url' }, 'invalid callback url'],
  ])('rejects %o (%s)', (overrides) => {
    expect(updatePaymentSettingsSchema.safeParse(overrides).success).toBe(false);
  });
});

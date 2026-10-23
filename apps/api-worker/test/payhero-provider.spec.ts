import { describe, expect, it } from 'vitest';
import { parsePayHeroCallback, toLocalKenyanPhone } from '../src/lib/payhero-provider';

describe('toLocalKenyanPhone', () => {
  it('converts +254 E.164 to local 0-prefixed', () => {
    expect(toLocalKenyanPhone('+254712345678')).toBe('0712345678');
  });

  it('converts bare 254-prefixed to local', () => {
    expect(toLocalKenyanPhone('254712345678')).toBe('0712345678');
  });

  it('passes through an already-local number', () => {
    expect(toLocalKenyanPhone('0712345678')).toBe('0712345678');
  });

  it('adds the leading 0 to a bare 9-digit number', () => {
    expect(toLocalKenyanPhone('712345678')).toBe('0712345678');
  });
});

describe('parsePayHeroCallback', () => {
  it('returns null for a non-object body', () => {
    expect(parsePayHeroCallback(null)).toBeNull();
    expect(parsePayHeroCallback('nope')).toBeNull();
  });

  it('returns null when no checkout id can be found', () => {
    expect(parsePayHeroCallback({ foo: 'bar' })).toBeNull();
  });

  it('parses the documented PascalCase shape, nested under `response`', () => {
    const result = parsePayHeroCallback({
      response: {
        CheckoutRequestID: 'ws_CO_123',
        ResultCode: 0,
        MpesaReceiptNumber: 'ABC123',
      },
    });
    expect(result).toEqual({
      checkoutRequestId: 'ws_CO_123',
      success: true,
      receipt: 'ABC123',
      resultDesc: undefined,
    });
  });

  it('parses a flattened snake_case variant', () => {
    const result = parsePayHeroCallback({
      checkout_request_id: 'ws_CO_456',
      result_code: '1',
      receipt_number: 'XYZ789',
      result_desc: 'Insufficient funds',
    });
    expect(result).toEqual({
      checkoutRequestId: 'ws_CO_456',
      success: false,
      receipt: 'XYZ789',
      resultDesc: 'Insufficient funds',
    });
  });

  it('falls back to a status string when no numeric result code is present', () => {
    const result = parsePayHeroCallback({ reference: 'ws_CO_789', status: 'Success' });
    expect(result).toMatchObject({ checkoutRequestId: 'ws_CO_789', success: true });
  });
});

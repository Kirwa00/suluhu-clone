import { describe, expect, it } from 'vitest';
import { MockMpesaProvider } from '../src/lib/mpesa-provider';

describe('MockMpesaProvider', () => {
  it('returns a push result without confirming (confirmation is a separate step)', async () => {
    const provider = new MockMpesaProvider();
    let confirmed = false;
    provider.registerConfirmHandler(async () => {
      confirmed = true;
    });

    const result = await provider.initiateStkPush({
      amountKsh: 3000,
      phone: '+254712345678',
      accountReference: 'SULUHU-TEST',
      description: 'Suluhu therapy session',
    });

    expect(result.checkoutRequestId).toMatch(/^ws_CO_/);
    expect(result.customerMessage).toContain('M-Pesa PIN');
    expect(confirmed).toBe(false);
  });

  it('simulateCallback invokes the registered handler with a success result', async () => {
    const provider = new MockMpesaProvider();
    const calls: unknown[] = [];
    provider.registerConfirmHandler(async (r) => {
      calls.push(r);
    });

    await provider.simulateCallback('ws_CO_abc');

    expect(calls).toEqual([
      { checkoutRequestId: 'ws_CO_abc', success: true, receipt: expect.stringMatching(/^MOCK/) },
    ]);
  });

  it('simulateCallback is a no-op when no handler is registered', async () => {
    const provider = new MockMpesaProvider();
    await expect(provider.simulateCallback('ws_CO_xyz')).resolves.toBeUndefined();
  });
});

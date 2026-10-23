/**
 * M-Pesa (Safaricom Daraja) STK Push provider — port of
 * apps/api/src/modules/payments/providers/mpesa.provider.ts.
 *
 * Production calls Daraja's STK Push endpoint (via PayHero, see
 * payhero-provider.ts) and receives the result via the
 * `/payments/mpesa/callback` or `/payments/payhero/callback` webhook.
 *
 * apps/api's mock self-confirms via `setTimeout(..., 2000)` *inside*
 * `initiateStkPush`, relying on the 2s delay to land after
 * `PaymentsService.initiateMpesa` has persisted the returned checkout id on
 * the payment row (`completeByCheckout` looks the payment up *by* that id).
 * A Worker's execution context isn't guaranteed to run a bare `setTimeout`
 * past the response (no `ctx.waitUntil()` reaches this deep), so this mock
 * splits the two steps instead: `initiateStkPush` only returns the push
 * result, and `simulateCallback(checkoutRequestId)` — called by
 * `PaymentsService` once it has actually persisted that id — does the
 * confirming. Same ordering guarantee apps/api gets from the delay, without
 * depending on one.
 */

export interface StkPushRequest {
  amountKsh: number;
  phone: string; // E.164 +2547...
  accountReference: string;
  description: string;
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  customerMessage: string;
}

export interface MpesaProvider {
  readonly mode: 'mock' | 'live';
  initiateStkPush(req: StkPushRequest): Promise<StkPushResult>;
}

/** Callback the payments service registers so the mock can confirm a push. */
export type MpesaConfirmFn = (result: {
  checkoutRequestId: string;
  success: boolean;
  receipt?: string;
}) => Promise<void>;

export class MockMpesaProvider implements MpesaProvider {
  readonly mode = 'mock' as const;
  private confirm: MpesaConfirmFn | null = null;

  /** The payments service injects its confirmation handler at startup. */
  registerConfirmHandler(fn: MpesaConfirmFn): void {
    this.confirm = fn;
  }

  async initiateStkPush(req: StkPushRequest): Promise<StkPushResult> {
    const checkoutRequestId = `ws_CO_${crypto.randomUUID()}`;
    console.log(`STK Push → ${req.phone} for KES ${req.amountKsh} (${req.accountReference})`);
    return {
      checkoutRequestId,
      merchantRequestId: crypto.randomUUID(),
      customerMessage: 'Enter your M-Pesa PIN on your phone to complete payment.',
    };
  }

  /** Simulates the customer approving the prompt; always succeeds in mock mode. */
  async simulateCallback(checkoutRequestId: string): Promise<void> {
    await this.confirm?.({
      checkoutRequestId,
      success: true,
      receipt: `MOCK${Date.now().toString().slice(-8)}`,
    });
  }
}

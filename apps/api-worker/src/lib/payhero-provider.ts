import { utf8ToBase64 } from './crypto';
import type { MpesaProvider, StkPushRequest, StkPushResult } from './mpesa-provider';

/**
 * PayHero (https://payhero.co.ke) M-Pesa aggregator — live STK Push provider.
 * Port of apps/api/src/modules/payments/providers/payhero.provider.ts, using
 * WebCrypto/`fetch` instead of `node:crypto`'s `Buffer`/`google-auth-library`-
 * style Node dependencies (Workers has neither). Same request/response
 * shape, same defensive callback parsing.
 */

export interface PayHeroConfig {
  apiUsername: string;
  apiPassword: string;
  channelId: number;
  callbackUrl: string;
  /** Override for testing; defaults to PayHero's production API. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://backend.payhero.co.ke';

/** Converts +254/254/07.../01... input into PayHero's expected local 0-prefixed format. */
export function toLocalKenyanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('254') && digits.length === 12) return `0${digits.slice(3)}`;
  if (digits.startsWith('0') && digits.length === 10) return digits;
  if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) {
    return `0${digits}`;
  }
  return digits;
}

interface PayHeroPaymentResponse {
  status?: string;
  success?: boolean;
  CheckoutRequestID?: string;
  checkout_request_id?: string;
  reference?: string;
  MerchantRequestID?: string;
  merchant_request_id?: string;
}

export interface PayHeroCallbackResult {
  checkoutRequestId: string;
  success: boolean;
  receipt?: string;
  resultDesc?: string;
}

/** Best-effort parse of PayHero's STK callback POST body. */
export function parsePayHeroCallback(body: unknown): PayHeroCallbackResult | null {
  if (!body || typeof body !== 'object') return null;

  const root = body as Record<string, unknown>;
  const r = (root.response && typeof root.response === 'object' ? root.response : root) as Record<
    string,
    unknown
  >;

  const checkoutRequestId =
    (r.CheckoutRequestID as string | undefined) ??
    (r.checkout_request_id as string | undefined) ??
    (r.reference as string | undefined);
  if (!checkoutRequestId) return null;

  const resultCode = r.ResultCode ?? r.result_code;
  const status = (r.Status ?? r.status) as string | undefined;
  const success =
    typeof resultCode === 'number'
      ? resultCode === 0
      : typeof resultCode === 'string'
        ? resultCode === '0'
        : status?.toLowerCase() === 'success';

  const receipt =
    (r.MpesaReceiptNumber as string | undefined) ??
    (r.mpesa_receipt_number as string | undefined) ??
    (r.receipt_number as string | undefined);

  const resultDesc = (r.ResultDesc ?? r.result_desc ?? status) as string | undefined;

  return { checkoutRequestId, success: Boolean(success), receipt, resultDesc };
}

export class PayHeroProvider implements MpesaProvider {
  readonly mode = 'live' as const;
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(private readonly config: PayHeroConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.authHeader = `Basic ${utf8ToBase64(`${config.apiUsername}:${config.apiPassword}`)}`;
  }

  async initiateStkPush(req: StkPushRequest): Promise<StkPushResult> {
    const body = {
      amount: Math.round(req.amountKsh),
      phone_number: toLocalKenyanPhone(req.phone),
      channel_id: this.config.channelId,
      provider: 'm-pesa',
      external_reference: req.accountReference,
      callback_url: this.config.callbackUrl,
    };

    const res = await fetch(`${this.baseUrl}/api/v2/payments`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
      console.error(`PayHero STK push failed (${res.status}): ${raw}`);
      throw new Error(`PayHero STK push failed with status ${res.status}`);
    }

    let parsed: PayHeroPaymentResponse;
    try {
      parsed = JSON.parse(raw) as PayHeroPaymentResponse;
    } catch {
      console.error(`PayHero STK push returned non-JSON response: ${raw}`);
      throw new Error('PayHero STK push returned an unparseable response');
    }

    const checkoutRequestId =
      parsed.CheckoutRequestID ?? parsed.checkout_request_id ?? parsed.reference;
    if (!checkoutRequestId) {
      console.error(`PayHero STK push response missing a checkout id: ${raw}`);
      throw new Error('PayHero STK push response missing a checkout id');
    }

    console.log(
      `STK Push → ${body.phone_number} for KES ${body.amount} (${req.accountReference}), checkout=${checkoutRequestId}`,
    );

    return {
      checkoutRequestId,
      merchantRequestId:
        parsed.MerchantRequestID ?? parsed.merchant_request_id ?? checkoutRequestId,
      customerMessage: 'Enter your M-Pesa PIN on your phone to complete payment.',
    };
  }
}

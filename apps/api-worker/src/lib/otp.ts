import {
  ErrorCode,
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
  type VerificationPurpose,
} from '@suluhu/shared';
import type { PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';
import { constantTimeEqual, randomDigits, sha256Hex } from './crypto';
import type { NotificationsService } from './notifications';

const ISSUE_THROTTLE_KEY_PREFIX = 'otp-issue:';
const MAX_ISSUANCES_PER_WINDOW = 3;
const THROTTLE_WINDOW_SECONDS = 15 * 60;

type Channel = 'sms' | 'email';

interface ThrottleState {
  count: number;
  resetAt: number;
}

/**
 * One-time passcodes for phone/email verification, MFA, and password reset —
 * port of apps/api/src/modules/auth/services/otp.service.ts. Codes are
 * hashed at rest, single-use, time-limited, and attempt-limited; issuance is
 * rate-limited per user+purpose.
 *
 * The issuance throttle (3 per 15 min) replaces Redis `INCR`+`EXPIRE` with a
 * read-modify-write counter in AUTH_KV (see wrangler.jsonc) — KV has no
 * atomic increment, so this is best-effort under concurrent requests from
 * the same user, same as the KV-backed access-token blocklist's fail-open
 * posture elsewhere in this Worker. The consequence of losing the race is
 * a slightly looser anti-abuse limit, never a security hole.
 */
export class OtpService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly kv: KVNamespace,
    private readonly notifications: NotificationsService,
  ) {}

  /** Generates, stores, and delivers a code. Returns nothing (out-of-band). */
  async issue(params: {
    userId: string;
    purpose: VerificationPurpose;
    deliverTo: { phone?: string; email?: string };
    channel: Channel;
  }): Promise<void> {
    await this.enforceIssueThrottle(params.userId, params.purpose);

    const code = randomDigits(OTP_LENGTH);
    // Invalidate any prior unconsumed codes for this purpose.
    await this.prisma.verificationCode.updateMany({
      where: { userId: params.userId, purpose: params.purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await this.prisma.verificationCode.create({
      data: {
        userId: params.userId,
        purpose: params.purpose,
        codeHash: await sha256Hex(code),
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      },
    });

    await this.deliver(code, params);
  }

  /** Verifies a submitted code; marks it consumed on success. */
  async verify(userId: string, purpose: VerificationPurpose, code: string): Promise<void> {
    const record = await this.prisma.verificationCode.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new AppException(ErrorCode.AUTH_OTP_INVALID, 'No active code. Request a new one.', 400);
    }
    if (record.expiresAt < new Date()) {
      throw new AppException(ErrorCode.AUTH_OTP_EXPIRED, 'Code expired. Request a new one.', 400);
    }
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      await this.prisma.verificationCode.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      throw new AppException(
        ErrorCode.AUTH_OTP_INVALID,
        'Too many attempts. Request a new code.',
        400,
      );
    }

    if (!constantTimeEqual(record.codeHash, await sha256Hex(code))) {
      await this.prisma.verificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new AppException(ErrorCode.AUTH_OTP_INVALID, 'Incorrect code.', 400);
    }

    await this.prisma.verificationCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
  }

  private async enforceIssueThrottle(userId: string, purpose: VerificationPurpose): Promise<void> {
    const key = `${ISSUE_THROTTLE_KEY_PREFIX}${userId}:${purpose}`;
    const now = Date.now();
    const raw = await this.kv.get(key);
    let state: ThrottleState = raw ? (JSON.parse(raw) as ThrottleState) : { count: 0, resetAt: 0 };
    if (now >= state.resetAt) {
      state = { count: 0, resetAt: now + THROTTLE_WINDOW_SECONDS * 1000 };
    }
    if (state.count >= MAX_ISSUANCES_PER_WINDOW) {
      throw new AppException(
        ErrorCode.RATE_LIMITED,
        'Too many code requests. Please wait a few minutes and try again.',
        429,
      );
    }
    state.count += 1;
    await this.kv.put(key, JSON.stringify(state), { expirationTtl: THROTTLE_WINDOW_SECONDS });
  }

  private async deliver(
    code: string,
    params: {
      purpose: VerificationPurpose;
      deliverTo: { phone?: string; email?: string };
      channel: Channel;
    },
  ): Promise<void> {
    const message = otpMessage(code, params.purpose);
    if (params.channel === 'sms' && params.deliverTo.phone) {
      await this.notifications.sendSms({ to: params.deliverTo.phone, body: message });
    } else if (params.channel === 'email' && params.deliverTo.email) {
      await this.notifications.sendEmail({
        to: params.deliverTo.email,
        subject: 'Your Suluhu verification code',
        text: message,
        html: `<p>${message}</p>`,
      });
    } else {
      console.warn(`No delivery target for OTP (${params.purpose})`);
    }
  }
}

function otpMessage(code: string, purpose: VerificationPurpose): string {
  const label: Record<VerificationPurpose, string> = {
    PHONE_VERIFICATION: 'verify your phone number',
    EMAIL_VERIFICATION: 'verify your email',
    MFA_CHALLENGE: 'sign in',
    PASSWORD_RESET: 'reset your password',
  };
  return `Your Suluhu code to ${label[purpose]} is ${code}. It expires in 5 minutes. Never share it.`;
}

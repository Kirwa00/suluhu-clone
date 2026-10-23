import type { Bindings } from '../../env';
import { AfricasTalkingSmsProvider } from './africas-talking-sms';
import { MockEmailProvider, MockSmsProvider } from './mock';
import { ResendEmailProvider } from './resend-email';
import type { EmailMessage, EmailProvider, SmsMessage, SmsProvider } from './types';

/**
 * Facade over notification channels — port of apps/api's
 * NotificationsService. Callers (auth, otp) depend on this rather than
 * concrete providers.
 */
export class NotificationsService {
  constructor(
    private readonly sms: SmsProvider,
    private readonly email: EmailProvider,
  ) {}

  sendSms(message: SmsMessage) {
    return this.sms.send(message);
  }

  sendEmail(message: EmailMessage) {
    return this.email.send(message);
  }

  /**
   * Test-only: the last message sent to a recipient, when the configured
   * provider is the mock one (SMS_MODE/EMAIL_MODE !== 'live'). Undefined
   * otherwise — live providers never retain message content.
   */
  getLastMockMessage(to: string): string | undefined {
    if (this.sms instanceof MockSmsProvider) {
      const sms = this.sms.getLast(to);
      if (sms) return sms;
    }
    if (this.email instanceof MockEmailProvider) {
      return this.email.getLast(to);
    }
    return undefined;
  }
}

/** Builds the notifications facade with live or mock providers per env mode. */
export function createNotificationsService(env: Bindings): NotificationsService {
  const sms: SmsProvider =
    env.SMS_MODE === 'live'
      ? new AfricasTalkingSmsProvider({
          username: env.AT_USERNAME ?? '',
          apiKey: env.AT_API_KEY ?? '',
          senderId: env.AT_SENDER_ID || undefined,
        })
      : new MockSmsProvider();

  const email: EmailProvider =
    env.EMAIL_MODE === 'live'
      ? new ResendEmailProvider({
          apiKey: env.RESEND_API_KEY ?? '',
          from: env.EMAIL_FROM ?? 'Suluhu Therapy Center <no-reply@suluhu.co.ke>',
        })
      : new MockEmailProvider();

  return new NotificationsService(sms, email);
}

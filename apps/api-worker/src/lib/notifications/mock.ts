import type { EmailMessage, EmailProvider, SendResult, SmsMessage, SmsProvider } from './types';

/**
 * Mock email/SMS providers — port of apps/api's MockEmailProvider /
 * MockSmsProvider. Log the message and keep the last one per recipient in
 * module-scope state (persists across requests on a warm isolate, same as
 * the Node in-memory Map it replaces) so a test harness can read back an
 * OTP without a real provider — see routes/auth.ts's `GET /test/otp`.
 */

const lastEmailByRecipient = new Map<string, string>();
const lastSmsByRecipient = new Map<string, string>();

export class MockEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<SendResult> {
    const body = message.text ?? message.html ?? '';
    console.log(`EMAIL → ${message.to}: ${message.subject}\n${body}`);
    lastEmailByRecipient.set(message.to, body);
    return { providerMessageId: `mock-email-${crypto.randomUUID()}`, accepted: true };
  }

  getLast(to: string): string | undefined {
    return lastEmailByRecipient.get(to);
  }
}

export class MockSmsProvider implements SmsProvider {
  async send(message: SmsMessage): Promise<SendResult> {
    console.log(`SMS → ${message.to}: ${message.body}`);
    lastSmsByRecipient.set(message.to, message.body);
    return { providerMessageId: `mock-sms-${crypto.randomUUID()}`, accepted: true };
  }

  getLast(to: string): string | undefined {
    return lastSmsByRecipient.get(to);
  }
}

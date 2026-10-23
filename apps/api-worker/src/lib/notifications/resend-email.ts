import type { EmailMessage, EmailProvider, SendResult } from './types';

/**
 * Resend HTTP API — live email provider. Replaces apps/api's
 * SmtpEmailProvider (nodemailer over raw SMTP sockets, which Workers can't
 * open): same account, same `EMAIL_FROM`, but over Resend's REST API instead
 * of its SMTP endpoint. https://resend.com/docs/api-reference/emails/send-email
 */

export interface ResendConfig {
  apiKey: string;
  from: string;
}

interface ResendSendResponse {
  id?: string;
}

interface ResendErrorResponse {
  message?: string;
}

export class ResendEmailProvider implements EmailProvider {
  constructor(private readonly config: ResendConfig) {}

  async send(message: EmailMessage): Promise<SendResult> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as ResendSendResponse & ResendErrorResponse;
    if (!res.ok) {
      console.error(`Resend send to ${message.to} failed (${res.status}): ${body.message ?? ''}`);
      throw new Error(`Resend email send failed with status ${res.status}`);
    }

    console.log(`EMAIL → ${message.to}: ${message.subject} (${body.id ?? ''})`);
    return { providerMessageId: body.id ?? '', accepted: true };
  }
}

/** Contracts for outbound notification channels — port of apps/api's notification.types.ts. */

export interface SmsMessage {
  to: string; // E.164
  body: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendResult {
  providerMessageId: string;
  accepted: boolean;
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<SendResult>;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<SendResult>;
}

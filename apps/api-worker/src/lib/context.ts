import { createPrismaClient } from '../db/prisma';
import type { Bindings, Env } from '../env';
import { AdminAlertsService } from './admin-alerts-service';
import { AdminTherapistsService } from './admin-therapists-service';
import { MockAiSoapProvider, type AiSoapProvider } from './ai-soap-provider';
import { MockAiSummaryProvider, type AiSummaryProvider } from './ai-summary';
import { AnalyticsService } from './analytics-service';
import { AppointmentsService } from './appointments-service';
import { AuditService } from './audit';
import { AuthService } from './auth-service';
import { ClinicalAccessService } from './clinical-access-service';
import { ClinicalNotesService } from './clinical-notes-service';
import { ContentService } from './content-service';
import { base64ToBytes } from './crypto';
import { MockCpbVerificationProvider, type CpbVerificationProvider } from './cpb-verification';
import { DailyVideoProvider } from './daily-provider';
import { DiscoveryService } from './discovery-service';
import { R2DocumentStorageService } from './document-storage';
import { GoogleIdentityService } from './google-identity';
import { HealthRecordService } from './health-record-service';
import { IntakeService } from './intake-service';
import { MessagingService } from './messaging-service';
import { MoodService } from './mood-service';
import { MockMpesaProvider, type MpesaProvider } from './mpesa-provider';
import { createNotificationsService, type NotificationsService } from './notifications';
import { OtpService } from './otp';
import { PasswordService } from './password';
import { PayHeroProvider } from './payhero-provider';
import { PaymentSettingsService } from './payment-settings-service';
import { PaymentsService } from './payments-service';
import { PhiCryptoService } from './phi-crypto';
import { RemindersService } from './reminders-service';
import { SessionsService } from './sessions-service';
import { SlotsService } from './slots-service';
import { TherapistDocumentsService } from './therapist-documents-service';
import { TherapistsService } from './therapists-service';
import { TokenService } from './token';
import { TreatmentPlansService } from './treatment-plans-service';
import { UsersService } from './users-service';
import type { VideoProvider } from './video-provider';
import { MockVideoProvider } from './video-provider';

export interface AuthContext {
  prisma: Awaited<ReturnType<typeof createPrismaClient>>;
  passwords: PasswordService;
  tokens: TokenService;
  otp: OtpService;
  google: GoogleIdentityService;
  audit: AuditService;
  phi: PhiCryptoService;
  notifications: NotificationsService;
  auth: AuthService;
  users: UsersService;
  cpb: CpbVerificationProvider;
  documents: R2DocumentStorageService;
  therapists: TherapistsService;
  therapistDocuments: TherapistDocumentsService;
  discovery: DiscoveryService;
  adminTherapists: AdminTherapistsService;
  adminAlerts: AdminAlertsService;
  ai: AiSummaryProvider;
  intake: IntakeService;
  slots: SlotsService;
  payments: PaymentsService;
  paymentSettings: PaymentSettingsService;
  appointments: AppointmentsService;
  video: VideoProvider;
  sessions: SessionsService;
  reminders: RemindersService;
  messaging: MessagingService;
  mood: MoodService;
  content: ContentService;
  clinicalAccess: ClinicalAccessService;
  aiSoap: AiSoapProvider;
  clinicalNotes: ClinicalNotesService;
  treatmentPlans: TreatmentPlansService;
  healthRecord: HealthRecordService;
  analytics: AnalyticsService;
}

/**
 * Wires up the request-scoped service graph — the Worker's equivalent of
 * NestJS constructor injection, built fresh per request alongside the
 * per-request Prisma client (see db/prisma.ts for why).
 */
export async function createAuthContext(env: Bindings, validated: Env): Promise<AuthContext> {
  const prisma = await createPrismaClient(env);
  const notifications = createNotificationsService(env);
  const passwords = new PasswordService(validated.PASSWORD_PBKDF2_ITERATIONS);
  const tokens = new TokenService(prisma, env.AUTH_KV, {
    accessSecret: validated.JWT_ACCESS_SECRET,
    accessTtl: validated.JWT_ACCESS_TTL,
    refreshTtl: validated.JWT_REFRESH_TTL,
  });
  const otp = new OtpService(prisma, env.AUTH_KV, notifications);
  const google = new GoogleIdentityService(validated.GOOGLE_CLIENT_ID);
  const audit = new AuditService(prisma);
  const phi = new PhiCryptoService(base64ToBytes(validated.PHI_ENCRYPTION_KEY));

  // No live CPB-portal integration exists yet on either backend — verification
  // is done by an admin reviewing the documents the therapist uploads. Port
  // of apps/api's TherapistsModule provider factory, including its warning.
  if (validated.PROVIDER_MODE === 'live') {
    console.warn(
      'PROVIDER_MODE=live but no live CPB-portal integration exists — using the mock CPB verification provider',
    );
  }
  const cpb = new MockCpbVerificationProvider();
  const documents = new R2DocumentStorageService(env.DOCUMENTS);

  // No live OpenAI adapter exists yet on either backend — port of
  // apps/api's IntakeModule provider factory, including its warning.
  if (validated.AI_MODE === 'live') {
    console.warn(
      'AI_MODE=live requested but no live AI intake-summary adapter is configured; using the mock summary.',
    );
  }
  const ai: AiSummaryProvider = new MockAiSummaryProvider();

  // Admin-managed PayHero config (DB) takes precedence over the static env
  // vars below — the env vars are only a fallback for an environment where
  // no admin has configured anything yet (e.g. local dev via .dev.vars).
  const paymentSettings = new PaymentSettingsService(prisma, phi, audit);
  const effectivePayment = await paymentSettings.getEffectiveConfig({
    mode: validated.MPESA_MODE === 'live' ? 'live' : 'mock',
    apiUsername: validated.PAYHERO_API_USERNAME,
    apiPassword: validated.PAYHERO_API_PASSWORD,
    channelId: validated.PAYHERO_CHANNEL_ID,
    baseUrl: validated.PAYHERO_BASE_URL,
    callbackUrl: validated.MPESA_CALLBACK_URL,
  });
  const mpesa: MpesaProvider =
    effectivePayment.mode === 'live' &&
    effectivePayment.apiUsername &&
    effectivePayment.apiPassword &&
    effectivePayment.channelId &&
    effectivePayment.callbackUrl
      ? new PayHeroProvider({
          apiUsername: effectivePayment.apiUsername,
          apiPassword: effectivePayment.apiPassword,
          channelId: effectivePayment.channelId,
          callbackUrl: effectivePayment.callbackUrl,
          baseUrl: effectivePayment.baseUrl,
        })
      : new MockMpesaProvider();

  const video: VideoProvider =
    validated.VIDEO_MODE === 'live'
      ? new DailyVideoProvider({
          apiKey: validated.DAILY_API_KEY!,
          domain: validated.DAILY_DOMAIN!,
          baseUrl: validated.DAILY_BASE_URL,
        })
      : new MockVideoProvider();

  const reminders = new RemindersService(prisma);
  const slots = new SlotsService(prisma);
  const payments = new PaymentsService(prisma, notifications, reminders, mpesa);
  // Port of apps/api's PaymentsService.onModuleInit(): wires the mock
  // provider's simulated callback back into completion. A fresh pairing is
  // built per request here instead of once at app boot, since there's no
  // Worker equivalent of a singleton module lifecycle.
  if (mpesa instanceof MockMpesaProvider) {
    mpesa.registerConfirmHandler((r) => payments.completeByCheckout(r));
  }

  // No live AI SOAP-draft adapter exists yet on either backend — port of
  // apps/api's ClinicalModule provider factory, including its warning. SOAP
  // notes are written directly by the therapist; this is an optional assist.
  if (validated.AI_MODE === 'live') {
    console.warn(
      'AI_MODE=live requested but no live AI SOAP-draft adapter is configured; using the mock draft assist.',
    );
  }
  const aiSoap: AiSoapProvider = new MockAiSoapProvider();
  const clinicalAccess = new ClinicalAccessService(prisma);

  return {
    prisma,
    passwords,
    tokens,
    otp,
    google,
    audit,
    phi,
    notifications,
    auth: new AuthService(prisma, passwords, tokens, otp, audit, google),
    users: new UsersService(prisma, phi),
    cpb,
    documents,
    therapists: new TherapistsService(prisma, audit, cpb),
    therapistDocuments: new TherapistDocumentsService(prisma, documents, audit),
    discovery: new DiscoveryService(prisma),
    adminTherapists: new AdminTherapistsService(prisma, audit, notifications, cpb),
    adminAlerts: new AdminAlertsService(prisma, audit),
    ai,
    intake: new IntakeService(
      prisma,
      audit,
      notifications,
      validated.BEFRIENDERS_KENYA_HOTLINE,
      ai,
    ),
    slots,
    payments,
    paymentSettings,
    appointments: new AppointmentsService(prisma, slots, payments, audit, notifications, reminders),
    video,
    sessions: new SessionsService(prisma, audit, video),
    reminders,
    messaging: new MessagingService(prisma, phi, audit),
    mood: new MoodService(prisma, phi),
    content: new ContentService(prisma),
    clinicalAccess,
    aiSoap,
    clinicalNotes: new ClinicalNotesService(prisma, phi, clinicalAccess, audit, aiSoap),
    treatmentPlans: new TreatmentPlansService(prisma, phi, clinicalAccess, audit),
    healthRecord: new HealthRecordService(prisma, clinicalAccess, audit),
    analytics: new AnalyticsService(prisma, audit),
  };
}

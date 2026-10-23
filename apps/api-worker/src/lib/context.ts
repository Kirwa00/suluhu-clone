import { createPrismaClient } from '../db/prisma';
import type { Bindings, Env } from '../env';
import { AdminAlertsService } from './admin-alerts-service';
import { AdminTherapistsService } from './admin-therapists-service';
import { AuditService } from './audit';
import { AuthService } from './auth-service';
import { base64ToBytes } from './crypto';
import { MockCpbVerificationProvider, type CpbVerificationProvider } from './cpb-verification';
import { DiscoveryService } from './discovery-service';
import { R2DocumentStorageService } from './document-storage';
import { GoogleIdentityService } from './google-identity';
import { createNotificationsService, type NotificationsService } from './notifications';
import { OtpService } from './otp';
import { PasswordService } from './password';
import { PhiCryptoService } from './phi-crypto';
import { TherapistDocumentsService } from './therapist-documents-service';
import { TherapistsService } from './therapists-service';
import { TokenService } from './token';
import { UsersService } from './users-service';

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
}

/**
 * Wires up the request-scoped service graph — the Worker's equivalent of
 * NestJS constructor injection, built fresh per request alongside the
 * per-request Prisma client (see db/prisma.ts for why).
 */
export async function createAuthContext(env: Bindings, validated: Env): Promise<AuthContext> {
  const prisma = await createPrismaClient(env);
  const notifications = createNotificationsService(env);
  const passwords = new PasswordService(validated.PASSWORD_SALT_ROUNDS);
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
  };
}

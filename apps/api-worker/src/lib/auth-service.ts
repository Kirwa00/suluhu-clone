import {
  ErrorCode,
  MFA_REQUIRED_ROLES,
  UserRole,
  UserStatus,
  VerificationPurpose,
  type AuthTokens,
  type AuthUser,
  type ChangePasswordInput,
  type GoogleRegisterInput,
  type LoginInput,
  type LoginResult,
  type RegisterInput,
} from '@suluhu/shared';
import type { Prisma, PrismaClient, User } from '../generated/prisma';
import { AppException } from './app-exception';
import { AuditService } from './audit';
import { randomTokenBase64Url } from './crypto';
import { GoogleIdentityService } from './google-identity';
import { OtpService } from './otp';
import { DUMMY_PASSWORD_HASH, PasswordService } from './password';
import { toAuthUser, TokenService } from './token';
import type { RequestContext } from './types';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

/**
 * Port of apps/api/src/modules/auth/auth.service.ts — same flows, same
 * validation order, same audit events, same error codes.
 */
export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly audit: AuditService,
    private readonly google: GoogleIdentityService,
  ) {}

  async register(
    input: RegisterInput,
    ctx: RequestContext,
    extra: Pick<Prisma.UserCreateInput, 'googleSub' | 'emailVerifiedAt'> = {},
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { phone: input.phone }] },
    });
    if (existing) {
      throw existing.email === email
        ? AppException.conflict(
            'An account with this email already exists',
            ErrorCode.AUTH_EMAIL_TAKEN,
          )
        : AppException.conflict(
            'An account with this phone already exists',
            ErrorCode.AUTH_PHONE_TAKEN,
          );
    }

    const passwordHash = await this.passwords.hash(input.password);
    const role = input.role as UserRole;
    const mfaEnabled = MFA_REQUIRED_ROLES.includes(role);

    const user = await this.prisma.user.create({
      data: {
        email,
        phone: input.phone,
        passwordHash,
        role,
        status: UserStatus.PENDING_VERIFICATION,
        firstName: input.firstName,
        lastName: input.lastName,
        locale: input.locale === 'sw' ? 'sw' : 'en',
        mfaEnabled,
        acceptedTermsAt: new Date(),
        ...extra,
        ...(role === UserRole.PATIENT
          ? { patientProfile: { create: {} } }
          : { therapistProfile: { create: {} } }),
      },
    });

    await this.otp.issue({
      userId: user.id,
      purpose: VerificationPurpose.PHONE_VERIFICATION,
      deliverTo: { phone: user.phone },
      channel: 'sms',
    });

    await this.audit.record({
      userId: user.id,
      action: 'auth.register',
      resourceType: 'user',
      resourceId: user.id,
      ...ctx,
      metadata: { role },
    });

    const authUser = toAuthUser(user);
    const tokens = await this.tokens.issueTokens(authUser, ctx);
    return { user: authUser, tokens };
  }

  async login(input: LoginInput, ctx: RequestContext): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: input.email.toLowerCase(), deletedAt: null },
    });

    const invalid = () =>
      AppException.unauthorized('Incorrect email or password', ErrorCode.AUTH_INVALID_CREDENTIALS);

    if (!user) {
      // Equalize timing against a non-existent account.
      await this.passwords.compare(input.password, DUMMY_PASSWORD_HASH);
      throw invalid();
    }

    this.assertCanSignIn(user);

    const ok = await this.passwords.compare(input.password, user.passwordHash);
    if (!ok) {
      await this.registerFailedLogin(user);
      throw invalid();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });

    return this.startSession(user, ctx);
  }

  /**
   * Sign in with a Google ID token. Matches the linked Google account first, then
   * links an existing account with the same (Google-verified) email. Unknown
   * emails get SIGNUP_REQUIRED so the client can collect a phone number.
   */
  async loginWithGoogle(credential: string, ctx: RequestContext): Promise<LoginResult> {
    const identity = await this.google.verify(credential);
    let user = await this.prisma.user.findFirst({
      where: { googleSub: identity.sub, deletedAt: null },
    });

    if (!user) {
      const byEmail = await this.prisma.user.findFirst({
        where: { email: identity.email, deletedAt: null },
      });
      if (!byEmail) {
        return {
          status: 'SIGNUP_REQUIRED',
          profile: {
            email: identity.email,
            firstName: identity.firstName,
            lastName: identity.lastName,
          },
        };
      }
      if (byEmail.googleSub) {
        throw AppException.unauthorized(
          'This account is linked to a different Google account',
          ErrorCode.AUTH_INVALID_CREDENTIALS,
        );
      }
      this.assertCanSignIn(byEmail);
      user = await this.prisma.user.update({
        where: { id: byEmail.id },
        data: { googleSub: identity.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() },
      });
      await this.audit.record({
        userId: user.id,
        action: 'auth.google.link',
        resourceType: 'user',
        resourceId: user.id,
        ...ctx,
      });
    }

    this.assertCanSignIn(user);
    return this.startSession(user, ctx);
  }

  /** Create an account from a Google ID token plus the fields Google doesn't provide (phone). */
  async registerWithGoogle(
    input: GoogleRegisterInput,
    ctx: RequestContext,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const { credential, ...rest } = input;
    const identity = await this.google.verify(credential);
    // Unusable random password: the user signs in with Google, or sets one via "forgot password".
    return this.register(
      { ...rest, email: identity.email, password: randomTokenBase64Url(32) },
      ctx,
      { googleSub: identity.sub, emailVerifiedAt: new Date() },
    );
  }

  async verifyMfa(
    mfaToken: string,
    code: string,
    ctx: RequestContext,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const userId = await this.tokens.verifyMfaChallenge(mfaToken);
    await this.otp.verify(userId, VerificationPurpose.MFA_CHALLENGE, code);
    const user = await this.getUserOrThrow(userId);
    return this.completeLogin(user, ctx);
  }

  async refresh(
    rawToken: string,
    ctx: RequestContext,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    return this.tokens.rotateRefreshToken(rawToken, ctx);
  }

  async logout(rawRefreshToken: string | undefined, accessJti: string | undefined): Promise<void> {
    if (rawRefreshToken) await this.tokens.revokeRefreshToken(rawRefreshToken);
    if (accessJti) await this.tokens.blocklistAccess(accessJti);
  }

  /** Requests a fresh verification/MFA code for the authenticated user. */
  async requestOtp(userId: string, purpose: VerificationPurpose): Promise<void> {
    const user = await this.getUserOrThrow(userId);
    const channel = purpose === VerificationPurpose.EMAIL_VERIFICATION ? 'email' : 'sms';
    await this.otp.issue({
      userId: user.id,
      purpose,
      deliverTo: { phone: user.phone, email: user.email },
      channel,
    });
  }

  async verifyOtp(
    userId: string,
    purpose: VerificationPurpose,
    code: string,
    ctx: RequestContext,
  ): Promise<{ user: AuthUser }> {
    await this.otp.verify(userId, purpose, code);
    const data: Partial<Pick<User, 'phoneVerifiedAt' | 'emailVerifiedAt' | 'status'>> = {};
    if (purpose === VerificationPurpose.PHONE_VERIFICATION) data.phoneVerifiedAt = new Date();
    if (purpose === VerificationPurpose.EMAIL_VERIFICATION) data.emailVerifiedAt = new Date();

    let updated = await this.prisma.user.update({ where: { id: userId }, data });
    // Activate once phone is verified (primary channel in Kenya).
    if (updated.status === UserStatus.PENDING_VERIFICATION && updated.phoneVerifiedAt) {
      updated = await this.prisma.user.update({
        where: { id: userId },
        data: { status: UserStatus.ACTIVE },
      });
    }

    await this.audit.record({
      userId,
      action: `auth.verify.${purpose.toLowerCase()}`,
      resourceType: 'user',
      resourceId: userId,
      ...ctx,
    });
    return { user: toAuthUser(updated) };
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });
    // Do not reveal whether the account exists.
    if (!user) return;
    await this.otp.issue({
      userId: user.id,
      purpose: VerificationPurpose.PASSWORD_RESET,
      deliverTo: { email: user.email },
      channel: 'email',
    });
  }

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), deletedAt: null },
    });
    if (!user) {
      throw new AppException(ErrorCode.AUTH_OTP_INVALID, 'Invalid or expired code.', 400);
    }
    await this.otp.verify(user.id, VerificationPurpose.PASSWORD_RESET, code);
    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.tokens.revokeAllForUser(user.id);
    await this.audit.record({
      userId: user.id,
      action: 'auth.password.reset',
      resourceType: 'user',
      resourceId: user.id,
      ...ctx,
    });
  }

  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.getUserOrThrow(userId);
    const ok = await this.passwords.compare(input.currentPassword, user.passwordHash);
    if (!ok) {
      throw AppException.badRequest(
        'Current password is incorrect',
        ErrorCode.AUTH_INVALID_CREDENTIALS,
      );
    }
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.tokens.revokeAllForUser(userId);
    await this.audit.record({
      userId,
      action: 'auth.password.change',
      resourceType: 'user',
      resourceId: userId,
      ...ctx,
    });
  }

  private assertCanSignIn(user: User): void {
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw AppException.unauthorized(
        'Account temporarily locked due to failed attempts. Try again later.',
        ErrorCode.ACCOUNT_SUSPENDED,
      );
    }
    if (user.status === UserStatus.SUSPENDED || user.status === UserStatus.DEACTIVATED) {
      throw AppException.unauthorized('Account is not active', ErrorCode.ACCOUNT_SUSPENDED);
    }
  }

  private async startSession(user: User, ctx: RequestContext): Promise<LoginResult> {
    if (user.mfaEnabled) {
      await this.otp.issue({
        userId: user.id,
        purpose: VerificationPurpose.MFA_CHALLENGE,
        deliverTo: { email: user.email },
        channel: 'email',
      });
      const mfaToken = await this.tokens.signMfaChallenge(user.id);
      await this.audit.record({
        userId: user.id,
        action: 'auth.login.mfa_challenge',
        resourceType: 'user',
        resourceId: user.id,
        ...ctx,
      });
      return { status: 'MFA_REQUIRED', mfaToken };
    }

    const session = await this.completeLogin(user, ctx);
    return { status: 'AUTHENTICATED', ...session };
  }

  private async completeLogin(
    user: User,
    ctx: RequestContext,
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const authUser = toAuthUser(user);
    const tokens = await this.tokens.issueTokens(authUser, ctx);
    await this.audit.record({
      userId: user.id,
      action: 'auth.login',
      resourceType: 'user',
      resourceId: user.id,
      ...ctx,
    });
    return { user: authUser, tokens };
  }

  private async registerFailedLogin(user: User): Promise<void> {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
      },
    });
  }

  private async getUserOrThrow(userId: string): Promise<User> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw AppException.notFound('Account not found');
    return user;
  }
}

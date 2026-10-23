import {
  TherapistVerificationStatus,
  type SetAvailabilityInput,
  type SubmitCredentialsInput,
} from '@suluhu/shared';
import type { PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';
import type { AuditService } from './audit';
import type { CpbVerificationProvider } from './cpb-verification';
import type { RequestContext } from './types';

export interface OnboardingStatus {
  verificationStatus: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  cpbCheck: unknown;
  checklist: {
    credentialsSubmitted: boolean;
    availabilitySet: boolean;
    cpbChecked: boolean;
    approved: boolean;
  };
}

/** Therapist self-service onboarding — port of apps/api's TherapistsService. */
export class TherapistsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly cpb: CpbVerificationProvider,
  ) {}

  private async profileByUser(userId: string) {
    const profile = await this.prisma.therapistProfile.findUnique({ where: { userId } });
    if (!profile) throw AppException.notFound('Therapist profile not found');
    return profile;
  }

  async submitCredentials(
    userId: string,
    input: SubmitCredentialsInput,
    ctx: RequestContext,
  ): Promise<OnboardingStatus> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppException.notFound('Account not found');

    // Run the automated CPB license check (SDLC §8.3) and store the result
    // for the admin reviewer. The therapist still requires manual approval.
    const cpbResult = await this.cpb.verify({
      licenseNumber: input.cpbLicenseNumber,
      holderName: `${user.firstName} ${user.lastName}`.trim(),
    });

    await this.prisma.therapistProfile.update({
      where: { userId },
      data: {
        cpbLicenseNumber: input.cpbLicenseNumber,
        cpbExpiry: new Date(input.cpbExpiry),
        title: input.title,
        gender: input.gender,
        bio: input.bio,
        specialties: input.specialties,
        languages: input.languages,
        yearsExperience: input.yearsExperience,
        sessionRateKsh: input.sessionRateKsh,
        verificationStatus: TherapistVerificationStatus.IN_REVIEW,
        submittedAt: new Date(),
        reviewedAt: null,
        rejectionReason: null,
        cpbVerifiedAt: new Date(),
        cpbCheckResult: cpbResult as object,
      },
    });

    await this.audit.record({
      userId,
      action: 'therapist.credentials.submit',
      resourceType: 'therapist_profile',
      resourceId: userId,
      ...ctx,
      metadata: { cpbValid: cpbResult.valid, cpbStatus: cpbResult.status },
    });

    return this.getOnboardingStatus(userId);
  }

  async getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
    const profile = await this.profileByUser(userId);
    const availabilityCount = await this.prisma.therapistAvailability.count({
      where: { therapistId: profile.id, isAvailable: true },
    });
    const credentialsSubmitted = Boolean(profile.cpbLicenseNumber && profile.submittedAt);
    return {
      verificationStatus: profile.verificationStatus,
      submittedAt: profile.submittedAt?.toISOString() ?? null,
      reviewedAt: profile.reviewedAt?.toISOString() ?? null,
      rejectionReason: profile.rejectionReason,
      cpbCheck: profile.cpbCheckResult,
      checklist: {
        credentialsSubmitted,
        availabilitySet: availabilityCount > 0,
        cpbChecked: Boolean(profile.cpbVerifiedAt),
        approved: profile.verificationStatus === TherapistVerificationStatus.APPROVED,
      },
    };
  }

  async setAvailability(
    userId: string,
    input: SetAvailabilityInput,
    ctx: RequestContext,
  ): Promise<{ slots: number }> {
    const profile = await this.profileByUser(userId);
    // Replace the full weekly schedule transactionally.
    await this.prisma.$transaction([
      this.prisma.therapistAvailability.deleteMany({ where: { therapistId: profile.id } }),
      this.prisma.therapistAvailability.createMany({
        data: input.slots.map((s) => ({
          therapistId: profile.id,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
          isAvailable: s.isAvailable,
        })),
      }),
    ]);
    await this.audit.record({
      userId,
      action: 'therapist.availability.set',
      resourceType: 'therapist_profile',
      resourceId: profile.id,
      ...ctx,
      metadata: { slots: input.slots.length },
    });
    return { slots: input.slots.length };
  }

  async getAvailability(userId: string) {
    const profile = await this.profileByUser(userId);
    return this.prisma.therapistAvailability.findMany({
      where: { therapistId: profile.id },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }
}

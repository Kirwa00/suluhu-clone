import { TherapistVerificationStatus, type Paginated, type ReviewDecisionInput } from '@suluhu/shared';
import type { Prisma, PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';
import type { AuditService } from './audit';
import type { CpbVerificationProvider } from './cpb-verification';
import type { NotificationsService } from './notifications';
import type { RequestContext } from './types';

const decisionToStatus: Record<ReviewDecisionInput['decision'], TherapistVerificationStatus> = {
  APPROVE: TherapistVerificationStatus.APPROVED,
  REJECT: TherapistVerificationStatus.REJECTED,
  SUSPEND: TherapistVerificationStatus.SUSPENDED,
};

/** Admin onboarding/approval workflow — port of apps/api's AdminTherapistsService. */
export class AdminTherapistsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly cpb: CpbVerificationProvider,
  ) {}

  async listApplications(params: {
    status?: TherapistVerificationStatus;
    page: number;
    pageSize: number;
  }): Promise<Paginated<unknown>> {
    const where: Prisma.TherapistProfileWhereInput = {
      deletedAt: null,
      verificationStatus: params.status ?? TherapistVerificationStatus.IN_REVIEW,
      submittedAt: { not: null },
    };
    const skip = (params.page - 1) * params.pageSize;
    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.therapistProfile.findMany({
        where,
        orderBy: { submittedAt: 'asc' },
        skip,
        take: params.pageSize,
        include: {
          user: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      }),
      this.prisma.therapistProfile.count({ where }),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      name: `${r.user.firstName} ${r.user.lastName}`.trim(),
      email: r.user.email,
      phone: r.user.phone,
      title: r.title,
      specialties: r.specialties,
      cpbLicenseNumber: r.cpbLicenseNumber,
      cpbCheck: r.cpbCheckResult,
      verificationStatus: r.verificationStatus,
      submittedAt: r.submittedAt?.toISOString() ?? null,
    }));
    const totalPages = Math.max(1, Math.ceil(totalItems / params.pageSize));
    return {
      items,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        totalItems,
        totalPages,
        hasNextPage: params.page < totalPages,
        hasPreviousPage: params.page > 1,
      },
    };
  }

  async getApplication(id: string) {
    const r = await this.prisma.therapistProfile.findUnique({
      where: { id },
      include: {
        user: {
          select: { firstName: true, lastName: true, email: true, phone: true, createdAt: true },
        },
        documents: true,
        availability: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
      },
    });
    if (!r) throw AppException.notFound('Application not found');
    return {
      id: r.id,
      name: `${r.user.firstName} ${r.user.lastName}`.trim(),
      email: r.user.email,
      phone: r.user.phone,
      title: r.title,
      gender: r.gender,
      bio: r.bio,
      specialties: r.specialties,
      languages: r.languages,
      yearsExperience: r.yearsExperience,
      sessionRateKsh: r.sessionRateKsh,
      cpbLicenseNumber: r.cpbLicenseNumber,
      cpbExpiry: r.cpbExpiry?.toISOString() ?? null,
      cpbCheck: r.cpbCheckResult,
      verificationStatus: r.verificationStatus,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      rejectionReason: r.rejectionReason,
      documents: r.documents.map((d) => ({
        id: d.id,
        type: d.type,
        originalName: d.originalName,
        uploadedAt: d.uploadedAt.toISOString(),
      })),
      availability: r.availability,
    };
  }

  async review(
    adminId: string,
    profileId: string,
    input: ReviewDecisionInput,
    ctx: RequestContext,
  ) {
    const profile = await this.prisma.therapistProfile.findUnique({
      where: { id: profileId },
      include: { user: { select: { email: true, firstName: true } } },
    });
    if (!profile) throw AppException.notFound('Application not found');

    const status = decisionToStatus[input.decision];

    // On approval, re-run the CPB check as a final gate and store the result.
    let cpbResult = profile.cpbCheckResult as unknown;
    if (input.decision === 'APPROVE' && profile.cpbLicenseNumber) {
      const result = await this.cpb.verify({
        licenseNumber: profile.cpbLicenseNumber,
        holderName: profile.user.firstName,
      });
      cpbResult = result;
      if (!result.valid) {
        throw AppException.conflict(
          `Cannot approve: CPB license is ${result.status.toLowerCase()}`,
        );
      }
    }

    await this.prisma.therapistProfile.update({
      where: { id: profileId },
      data: {
        verificationStatus: status,
        reviewedAt: new Date(),
        reviewedById: adminId,
        rejectionReason: input.decision === 'APPROVE' ? null : (input.reason ?? null),
        cpbCheckResult: cpbResult as object,
      },
    });

    await this.audit.record({
      userId: adminId,
      action: `admin.therapist.${input.decision.toLowerCase()}`,
      resourceType: 'therapist_profile',
      resourceId: profileId,
      ...ctx,
      metadata: { decision: input.decision, reason: input.reason },
    });

    await this.notifyOutcome(profile.user.email, profile.user.firstName, input);

    return { id: profileId, verificationStatus: status };
  }

  private async notifyOutcome(
    email: string,
    firstName: string,
    input: ReviewDecisionInput,
  ): Promise<void> {
    const messages: Record<ReviewDecisionInput['decision'], { subject: string; body: string }> = {
      APPROVE: {
        subject: 'Your Suluhu therapist application is approved',
        body: `Hi ${firstName}, your application has been approved. You can now set your availability and start accepting clients.`,
      },
      REJECT: {
        subject: 'Update on your Suluhu therapist application',
        body: `Hi ${firstName}, we were unable to approve your application. Reason: ${input.reason ?? 'not specified'}. You may update your details and resubmit.`,
      },
      SUSPEND: {
        subject: 'Your Suluhu therapist account has been suspended',
        body: `Hi ${firstName}, your account has been suspended. Reason: ${input.reason ?? 'not specified'}. Please contact support.`,
      },
    };
    const msg = messages[input.decision];
    await this.notifications.sendEmail({
      to: email,
      subject: msg.subject,
      text: msg.body,
      html: `<p>${msg.body}</p>`,
    });
  }
}

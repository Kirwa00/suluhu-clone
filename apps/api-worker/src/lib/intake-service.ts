import {
  TherapistVerificationStatus,
  UserRole,
  UserStatus,
  evaluateIntake,
  recommendSpecialties,
  type SubmitIntakeInput,
} from '@suluhu/shared';
import type { PrismaClient } from '../generated/prisma';
import type { AiSummaryProvider } from './ai-summary';
import { AppException } from './app-exception';
import type { AuditService } from './audit';
import type { NotificationsService } from './notifications';
import type { RequestContext } from './types';

export interface TherapistMatch {
  id: string;
  name: string;
  title: string | null;
  specialties: string[];
  sessionRateKsh: number | null;
  ratingAvg: number;
}

/** PHQ-9/GAD-7/CAGE intake & triage — port of apps/api's IntakeService. */
export class IntakeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly befriendersHotline: string,
    private readonly ai: AiSummaryProvider,
  ) {}

  async submit(patientUserId: string, input: SubmitIntakeInput, ctx: RequestContext) {
    const scores = evaluateIntake({
      phq9Answers: input.phq9Answers,
      gad7Answers: input.gad7Answers,
      cageAnswers: input.cageAnswers,
    });
    const recommendedSpecialties = recommendSpecialties({
      phq9Score: scores.phq9Score,
      gad7Score: scores.gad7Score,
      cageScore: scores.cageScore,
      primaryConcern: input.primaryConcern,
    });
    const aiSummary = await this.ai.summarize({ ...scores, primaryConcern: input.primaryConcern });

    const assessment = await this.prisma.intakeAssessment.create({
      data: {
        patientId: patientUserId,
        phq9Score: scores.phq9Score,
        gad7Score: scores.gad7Score,
        cageScore: scores.cageScore,
        riskLevel: scores.riskLevel,
        crisisFlag: scores.crisisFlag,
        primaryConcern: input.primaryConcern ?? null,
        recommendedSpecialties,
        answers: {
          phq9Answers: input.phq9Answers,
          gad7Answers: input.gad7Answers,
          cageAnswers: input.cageAnswers,
        },
        aiSummary,
      },
    });

    await this.audit.record({
      userId: patientUserId,
      action: 'intake.submit',
      resourceType: 'intake_assessment',
      resourceId: assessment.id,
      phiAccessed: true,
      ...ctx,
      metadata: { riskLevel: scores.riskLevel, crisisFlag: scores.crisisFlag },
    });

    if (scores.crisisFlag) {
      await this.raiseCrisisAlert(patientUserId, assessment.id, ctx);
    }

    const matches = await this.findMatches(recommendedSpecialties);

    return {
      assessmentId: assessment.id,
      phq9Score: scores.phq9Score,
      gad7Score: scores.gad7Score,
      cageScore: scores.cageScore,
      riskLevel: scores.riskLevel,
      crisisFlag: scores.crisisFlag,
      recommendedSpecialties,
      aiSummary,
      crisisResources: scores.crisisFlag
        ? {
            hotline: this.befriendersHotline,
            message:
              'If you are in immediate danger, please call now. You deserve support and you are not alone.',
          }
        : null,
      matches,
    };
  }

  async getLatest(patientUserId: string) {
    const assessment = await this.prisma.intakeAssessment.findFirst({
      where: { patientId: patientUserId },
      orderBy: { completedAt: 'desc' },
    });
    if (!assessment) return { assessment: null, matches: [] as TherapistMatch[] };
    const matches = await this.findMatches(assessment.recommendedSpecialties);
    return {
      assessment: {
        id: assessment.id,
        phq9Score: assessment.phq9Score,
        gad7Score: assessment.gad7Score,
        cageScore: assessment.cageScore,
        riskLevel: assessment.riskLevel,
        crisisFlag: assessment.crisisFlag,
        recommendedSpecialties: assessment.recommendedSpecialties,
        aiSummary: assessment.aiSummary,
        completedAt: assessment.completedAt.toISOString(),
      },
      matches,
    };
  }

  async history(patientUserId: string) {
    const rows = await this.prisma.intakeAssessment.findMany({
      where: { patientId: patientUserId },
      orderBy: { completedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        phq9Score: true,
        gad7Score: true,
        cageScore: true,
        riskLevel: true,
        completedAt: true,
      },
    });
    return rows.map((r) => ({ ...r, completedAt: r.completedAt.toISOString() }));
  }

  private async findMatches(specialties: string[]): Promise<TherapistMatch[]> {
    const rows = await this.prisma.therapistProfile.findMany({
      where: {
        deletedAt: null,
        verificationStatus: TherapistVerificationStatus.APPROVED,
        user: { is: { status: UserStatus.ACTIVE } },
        ...(specialties.length ? { specialties: { hasSome: specialties } } : {}),
      },
      orderBy: { ratingAvg: 'desc' },
      take: 3,
      include: { user: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      name: `${r.user.firstName} ${r.user.lastName}`.trim(),
      title: r.title,
      specialties: r.specialties,
      sessionRateKsh: r.sessionRateKsh,
      ratingAvg: r.ratingAvg,
    }));
  }

  private async raiseCrisisAlert(
    patientUserId: string,
    assessmentId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const patient = await this.prisma.user.findUnique({ where: { id: patientUserId } });
    await this.prisma.clinicalAlert.create({
      data: {
        patientId: patientUserId,
        type: 'CRISIS',
        message: `Crisis indicators detected during intake for ${patient?.firstName ?? 'a patient'}. Immediate clinical review required.`,
        sourceType: 'intake_assessment',
        sourceId: assessmentId,
      },
    });

    await this.audit.record({
      userId: patientUserId,
      action: 'intake.crisis_alert',
      resourceType: 'intake_assessment',
      resourceId: assessmentId,
      phiAccessed: true,
      ...ctx,
    });

    const admins = await this.prisma.user.findMany({
      where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] }, status: UserStatus.ACTIVE },
      select: { email: true, phone: true },
    });
    const body = `URGENT: A patient intake just flagged crisis indicators. Please review the clinical alerts queue immediately.`;
    await Promise.all(
      admins.flatMap((a) => [
        this.notifications.sendSms({ to: a.phone, body }),
        this.notifications.sendEmail({
          to: a.email,
          subject: 'URGENT: Crisis alert from patient intake',
          text: body,
          html: `<p><strong>${body}</strong></p>`,
        }),
      ]),
    );
  }

  async getAssessmentForUser(assessmentId: string, userId: string) {
    const a = await this.prisma.intakeAssessment.findUnique({ where: { id: assessmentId } });
    if (!a) throw AppException.notFound('Assessment not found');
    if (a.patientId !== userId) throw AppException.forbidden();
    return a;
  }
}

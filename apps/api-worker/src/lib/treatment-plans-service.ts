import type { AuthUser, TreatmentPlanInput } from '@suluhu/shared';
import type { PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';
import type { AuditService } from './audit';
import type { ClinicalAccessService } from './clinical-access-service';
import type { PhiCryptoService } from './phi-crypto';
import type { RequestContext } from './types';

export interface TreatmentPlanView {
  id: string;
  goals: string[];
  interventions: string[];
  reviewDate: string | null;
  status: string;
  summary: string;
  updatedAt: string;
}

/** Treatment plans — port of apps/api's TreatmentPlansService. */
export class TreatmentPlansService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly phi: PhiCryptoService,
    private readonly access: ClinicalAccessService,
    private readonly audit: AuditService,
  ) {}

  async upsert(
    therapistUserId: string,
    input: TreatmentPlanInput,
    ctx: RequestContext,
  ): Promise<TreatmentPlanView> {
    if (!(await this.access.therapistTreats(therapistUserId, input.patientId))) {
      throw AppException.forbidden('You are not assigned to this patient');
    }
    const existing = await this.prisma.treatmentPlan.findFirst({
      where: { patientId: input.patientId, therapistId: therapistUserId },
    });
    const data = {
      goals: input.goals,
      interventions: input.interventions,
      reviewDate: input.reviewDate ? new Date(input.reviewDate) : null,
      status: input.status,
      summaryEnc: input.summary?.trim() ? await this.phi.encrypt(input.summary.trim()) : null,
    };
    const plan = existing
      ? await this.prisma.treatmentPlan.update({ where: { id: existing.id }, data })
      : await this.prisma.treatmentPlan.create({
          data: { patientId: input.patientId, therapistId: therapistUserId, ...data },
        });

    await this.audit.record({
      userId: therapistUserId,
      action: 'treatment_plan.save',
      resourceType: 'treatment_plan',
      resourceId: plan.id,
      phiAccessed: true,
      ...ctx,
    });
    return this.toView(plan);
  }

  async getForPatient(patientId: string, requester: AuthUser): Promise<TreatmentPlanView | null> {
    await this.access.assertCanViewPatient(requester, patientId);
    const plan = await this.prisma.treatmentPlan.findFirst({
      where: { patientId },
      orderBy: { updatedAt: 'desc' },
    });
    return plan ? this.toView(plan) : null;
  }

  private async toView(plan: {
    id: string;
    goals: string[];
    interventions: string[];
    reviewDate: Date | null;
    status: string;
    summaryEnc: string | null;
    updatedAt: Date;
  }): Promise<TreatmentPlanView> {
    return {
      id: plan.id,
      goals: plan.goals,
      interventions: plan.interventions,
      reviewDate: plan.reviewDate?.toISOString() ?? null,
      status: plan.status,
      summary: plan.summaryEnc ? await this.phi.decrypt(plan.summaryEnc) : '',
      updatedAt: plan.updatedAt.toISOString(),
    };
  }
}

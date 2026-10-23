import {
  ClinicalNoteStatus,
  UserRole,
  type AiDraftRequest,
  type AuthUser,
  type SoapNoteInput,
} from '@suluhu/shared';
import type { PrismaClient } from '../generated/prisma';
import type { AiSoapProvider, SoapDraft } from './ai-soap-provider';
import type { AuditService } from './audit';
import type { ClinicalAccessService } from './clinical-access-service';
import type { PhiCryptoService } from './phi-crypto';
import type { RequestContext } from './types';

export interface SoapNoteView {
  id: string;
  appointmentId: string | null;
  status: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  riskAssessment: string;
  finalizedAt: string | null;
  scheduledAt: string | null;
  updatedAt: string;
}

/** SOAP clinical notes — port of apps/api's ClinicalNotesService. */
export class ClinicalNotesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly phi: PhiCryptoService,
    private readonly access: ClinicalAccessService,
    private readonly audit: AuditService,
    private readonly aiSoap: AiSoapProvider,
  ) {}

  private async enc(value: string | undefined | null): Promise<string | null> {
    const v = (value ?? '').trim();
    return v ? await this.phi.encrypt(v) : null;
  }
  private async dec(value: string | null): Promise<string> {
    return value ? await this.phi.decrypt(value) : '';
  }

  async upsert(
    therapistUserId: string,
    input: SoapNoteInput,
    ctx: RequestContext,
  ): Promise<SoapNoteView> {
    const appt = await this.access.assertTherapistOwnsAppointment(
      therapistUserId,
      input.appointmentId,
    );
    const finalizing = input.status === ClinicalNoteStatus.FINALIZED;

    const data = {
      patientId: appt.patientId,
      therapistId: therapistUserId,
      subjectiveEnc: await this.enc(input.subjective),
      objectiveEnc: await this.enc(input.objective),
      assessmentEnc: await this.enc(input.assessment),
      planEnc: await this.enc(input.plan),
      riskAssessmentEnc: await this.enc(input.riskAssessment),
      status: input.status,
      finalizedAt: finalizing ? new Date() : null,
    };

    const note = await this.prisma.clinicalNote.upsert({
      where: { appointmentId: input.appointmentId },
      create: { appointmentId: input.appointmentId, ...data },
      update: data,
    });

    await this.audit.record({
      userId: therapistUserId,
      action: finalizing ? 'clinical_note.finalize' : 'clinical_note.save_draft',
      resourceType: 'clinical_note',
      resourceId: note.id,
      phiAccessed: true,
      ...ctx,
    });

    return this.toView(note, appt.scheduledAt);
  }

  async getByAppointment(
    appointmentId: string,
    requester: AuthUser,
    ctx: RequestContext,
  ): Promise<SoapNoteView | null> {
    const note = await this.prisma.clinicalNote.findUnique({
      where: { appointmentId },
      include: { appointment: { select: { scheduledAt: true } } },
    });
    if (!note) return null;
    await this.access.assertCanViewPatient(requester, note.patientId);
    // Patients only see finalized notes.
    if (requester.role === UserRole.PATIENT && note.status !== ClinicalNoteStatus.FINALIZED) {
      return null;
    }
    await this.audit.record({
      userId: requester.id,
      action: 'clinical_note.view',
      resourceType: 'clinical_note',
      resourceId: note.id,
      phiAccessed: true,
      ...ctx,
    });
    return this.toView(note, note.appointment?.scheduledAt ?? null);
  }

  async listForPatient(patientId: string, requester: AuthUser): Promise<SoapNoteView[]> {
    await this.access.assertCanViewPatient(requester, patientId);
    const where =
      requester.role === UserRole.PATIENT
        ? { patientId, status: ClinicalNoteStatus.FINALIZED }
        : requester.role === UserRole.THERAPIST
          ? { patientId, therapistId: requester.id }
          : { patientId };
    const notes = await this.prisma.clinicalNote.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { appointment: { select: { scheduledAt: true } } },
    });
    return Promise.all(notes.map((n) => this.toView(n, n.appointment?.scheduledAt ?? null)));
  }

  async draftAi(therapistUserId: string, req: AiDraftRequest): Promise<SoapDraft> {
    const appt = await this.access.assertTherapistOwnsAppointment(
      therapistUserId,
      req.appointmentId,
    );
    const [patient, intake] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: appt.patientId }, select: { firstName: true } }),
      this.prisma.intakeAssessment.findFirst({
        where: { patientId: appt.patientId },
        orderBy: { completedAt: 'desc' },
        select: { phq9Score: true, gad7Score: true, primaryConcern: true },
      }),
    ]);
    return this.aiSoap.draft({
      patientFirstName: patient?.firstName ?? 'The client',
      primaryConcern: intake?.primaryConcern ?? null,
      phq9Score: intake?.phq9Score ?? null,
      gad7Score: intake?.gad7Score ?? null,
      durationMins: appt.durationMins,
      therapistModality: req.therapistModality,
    });
  }

  private async toView(
    note: {
      id: string;
      appointmentId: string | null;
      status: string;
      subjectiveEnc: string | null;
      objectiveEnc: string | null;
      assessmentEnc: string | null;
      planEnc: string | null;
      riskAssessmentEnc: string | null;
      finalizedAt: Date | null;
      updatedAt: Date;
    },
    scheduledAt: Date | null,
  ): Promise<SoapNoteView> {
    return {
      id: note.id,
      appointmentId: note.appointmentId,
      status: note.status,
      subjective: await this.dec(note.subjectiveEnc),
      objective: await this.dec(note.objectiveEnc),
      assessment: await this.dec(note.assessmentEnc),
      plan: await this.dec(note.planEnc),
      riskAssessment: await this.dec(note.riskAssessmentEnc),
      finalizedAt: note.finalizedAt?.toISOString() ?? null,
      scheduledAt: scheduledAt?.toISOString() ?? null,
      updatedAt: note.updatedAt.toISOString(),
    };
  }
}

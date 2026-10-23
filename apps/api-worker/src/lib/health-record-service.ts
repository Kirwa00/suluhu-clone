import { AppointmentStatus, UserRole, type AuthUser } from '@suluhu/shared';
import type { PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';
import type { AuditService } from './audit';
import type { ClinicalAccessService } from './clinical-access-service';
import type { RequestContext } from './types';

/** Aggregated patient health record + therapist caseload — port of apps/api's HealthRecordService. */
export class HealthRecordService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly access: ClinicalAccessService,
    private readonly audit: AuditService,
  ) {}

  /** Aggregated patient health record (intake, sessions, plan, alerts). */
  async getRecord(patientId: string, requester: AuthUser, ctx: RequestContext) {
    await this.access.assertCanViewPatient(requester, patientId);

    const patient = await this.prisma.user.findUnique({
      where: { id: patientId },
      include: { patientProfile: true },
    });
    if (!patient) throw AppException.notFound('Patient not found');

    const isTherapist = requester.role === UserRole.THERAPIST;
    const apptWhere = isTherapist ? { patientId, therapistId: requester.id } : { patientId };

    const [latestIntake, intakeHistory, appointments, plan, openAlerts, notesCount] =
      await Promise.all([
        this.prisma.intakeAssessment.findFirst({
          where: { patientId },
          orderBy: { completedAt: 'desc' },
        }),
        this.prisma.intakeAssessment.findMany({
          where: { patientId },
          orderBy: { completedAt: 'asc' },
          select: { phq9Score: true, gad7Score: true, completedAt: true },
        }),
        this.prisma.appointment.findMany({
          where: apptWhere,
          orderBy: { scheduledAt: 'desc' },
          take: 20,
          include: {
            therapist: { select: { firstName: true, lastName: true } },
          },
        }),
        this.prisma.treatmentPlan.findFirst({
          where: { patientId },
          orderBy: { updatedAt: 'desc' },
        }),
        requester.role === UserRole.PATIENT
          ? Promise.resolve([])
          : this.prisma.clinicalAlert.findMany({
              where: { patientId, status: { not: 'RESOLVED' } },
              orderBy: { createdAt: 'desc' },
            }),
        this.prisma.clinicalNote.count({
          where: isTherapist ? { patientId, therapistId: requester.id } : { patientId },
        }),
      ]);

    await this.audit.record({
      userId: requester.id,
      action: 'health_record.view',
      resourceType: 'patient',
      resourceId: patientId,
      phiAccessed: true,
      ...ctx,
    });

    return {
      patient: {
        id: patient.id,
        name: `${patient.firstName} ${patient.lastName}`.trim(),
        county: patient.patientProfile?.county ?? null,
        gender: patient.patientProfile?.gender ?? null,
      },
      latestIntake: latestIntake
        ? {
            phq9Score: latestIntake.phq9Score,
            gad7Score: latestIntake.gad7Score,
            cageScore: latestIntake.cageScore,
            riskLevel: latestIntake.riskLevel,
            primaryConcern: latestIntake.primaryConcern,
            completedAt: latestIntake.completedAt.toISOString(),
          }
        : null,
      intakeTrend: intakeHistory.map((i) => ({
        phq9: i.phq9Score,
        gad7: i.gad7Score,
        date: i.completedAt.toISOString(),
      })),
      appointments: appointments.map((a) => ({
        id: a.id,
        scheduledAt: a.scheduledAt.toISOString(),
        durationMins: a.durationMins,
        status: a.status,
        hasNote: false, // hydrated client-side per note fetch if needed
        therapistName: `${a.therapist.firstName} ${a.therapist.lastName}`.trim(),
        completed: a.status === AppointmentStatus.COMPLETED,
      })),
      treatmentPlan: plan
        ? { goals: plan.goals, interventions: plan.interventions, status: plan.status }
        : null,
      openAlerts: openAlerts.map((al) => ({
        id: al.id,
        type: al.type,
        message: al.message,
        createdAt: al.createdAt.toISOString(),
      })),
      notesCount,
    };
  }

  /** Therapists' caseload: distinct patients with last session + latest risk. */
  async listClients(therapistUserId: string) {
    const appts = await this.prisma.appointment.findMany({
      where: { therapistId: therapistUserId },
      orderBy: { scheduledAt: 'desc' },
      include: { patient: { select: { id: true, firstName: true, lastName: true } } },
    });

    const byPatient = new Map<
      string,
      { id: string; name: string; lastSession: string; count: number }
    >();
    for (const a of appts) {
      const existing = byPatient.get(a.patientId);
      if (existing) {
        existing.count += 1;
      } else {
        byPatient.set(a.patientId, {
          id: a.patientId,
          name: `${a.patient.firstName} ${a.patient.lastName}`.trim(),
          lastSession: a.scheduledAt.toISOString(),
          count: 1,
        });
      }
    }

    const clients = [...byPatient.values()];
    // Attach latest risk level per client.
    const risks = await this.prisma.intakeAssessment.findMany({
      where: { patientId: { in: clients.map((c) => c.id) } },
      orderBy: { completedAt: 'desc' },
      select: { patientId: true, riskLevel: true, completedAt: true },
    });
    const latestRisk = new Map<string, string>();
    for (const r of risks)
      if (!latestRisk.has(r.patientId)) latestRisk.set(r.patientId, r.riskLevel);

    return clients.map((c) => ({ ...c, riskLevel: latestRisk.get(c.id) ?? null }));
  }
}

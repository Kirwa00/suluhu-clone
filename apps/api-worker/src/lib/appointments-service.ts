import {
  AppointmentStatus,
  FREE_SESSIONS_PER_PATIENT,
  FREE_SESSION_DURATION_MINS,
  TherapistVerificationStatus,
  UserRole,
  type CreateAppointmentInput,
} from '@suluhu/shared';
import type { Prisma, PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';
import type { AuditService } from './audit';
import type { NotificationsService } from './notifications';
import type { PaymentsService } from './payments-service';
import type { RemindersStub } from './reminders-stub';
import type { SlotsService } from './slots-service';
import type { RequestContext } from './types';

const apptInclude = {
  patient: { select: { firstName: true, lastName: true } },
  therapist: {
    select: { firstName: true, lastName: true, therapistProfile: { select: { title: true } } },
  },
  payment: { select: { status: true, method: true, amountKsh: true } },
} satisfies Prisma.AppointmentInclude;

type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof apptInclude }>;

/** Booking lifecycle — port of apps/api's AppointmentsService. */
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly slots: SlotsService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly reminders: RemindersStub,
  ) {}

  async create(patientUserId: string, input: CreateAppointmentInput, ctx: RequestContext) {
    const patient = await this.prisma.user.findUnique({
      where: { id: patientUserId },
      include: { patientProfile: true },
    });
    if (!patient || !patient.patientProfile) {
      throw AppException.badRequest('Only patients can book sessions');
    }

    const therapist = await this.prisma.therapistProfile.findFirst({
      where: { id: input.therapistId, deletedAt: null },
      include: { user: true },
    });
    if (!therapist || therapist.verificationStatus !== TherapistVerificationStatus.APPROVED) {
      throw AppException.notFound('Therapist not available for booking');
    }
    if (therapist.userId === patientUserId) {
      throw AppException.badRequest('You cannot book a session with yourself');
    }

    const available = await this.slots.isSlotAvailable(
      input.therapistId,
      input.scheduledAt,
      input.durationMins,
    );
    if (!available) {
      throw AppException.conflict('That time slot is no longer available. Please pick another.');
    }

    const isFree =
      input.durationMins === FREE_SESSION_DURATION_MINS &&
      patient.patientProfile.freeSessionsUsed < FREE_SESSIONS_PER_PATIENT;

    if (!isFree && (therapist.sessionRateKsh == null || therapist.sessionRateKsh <= 0)) {
      throw AppException.conflict('This therapist has not set a session rate yet');
    }
    const priceKsh = isFree ? 0 : (therapist.sessionRateKsh as number);

    const appointment = await this.prisma.appointment.create({
      data: {
        patientId: patientUserId,
        therapistId: therapist.userId,
        scheduledAt: new Date(input.scheduledAt),
        durationMins: input.durationMins,
        priceKsh,
        isFreeSession: isFree,
        status: isFree ? AppointmentStatus.SCHEDULED : AppointmentStatus.PENDING_PAYMENT,
      },
    });

    await this.audit.record({
      userId: patientUserId,
      action: 'appointment.create',
      resourceType: 'appointment',
      resourceId: appointment.id,
      ...ctx,
      metadata: { therapistId: therapist.userId, isFree, priceKsh },
    });

    if (isFree) {
      await this.prisma.patientProfile.update({
        where: { userId: patientUserId },
        data: { freeSessionsUsed: { increment: 1 } },
      });
      await this.payments.recordFreeSession(appointment.id);
      await this.notifyFreeConfirmation(patient.phone, patient.firstName, appointment.scheduledAt);
      await this.reminders.scheduleForAppointment(appointment.id, appointment.scheduledAt);
      return {
        appointment: await this.getOne(appointment.id, patientUserId),
        requiresPayment: false as const,
      };
    }

    const push = await this.payments.initiateMpesa({
      appointmentId: appointment.id,
      amountKsh: priceKsh,
      phone: input.payerPhone ?? patient.phone,
      reference: `SULUHU-${appointment.id.slice(0, 8)}`,
    });

    return {
      appointment: await this.getOne(appointment.id, patientUserId),
      requiresPayment: true as const,
      checkoutRequestId: push.checkoutRequestId,
      customerMessage: push.customerMessage,
    };
  }

  async list(userId: string, role: UserRole, scope: 'upcoming' | 'past' | 'all') {
    const partyWhere: Prisma.AppointmentWhereInput =
      role === UserRole.THERAPIST ? { therapistId: userId } : { patientId: userId };

    const now = new Date();
    const scopeWhere: Prisma.AppointmentWhereInput =
      scope === 'upcoming'
        ? {
            scheduledAt: { gte: now },
            status: {
              in: [
                AppointmentStatus.SCHEDULED,
                AppointmentStatus.PENDING_PAYMENT,
                AppointmentStatus.IN_PROGRESS,
              ],
            },
          }
        : scope === 'past'
          ? {
              OR: [
                { scheduledAt: { lt: now } },
                {
                  status: {
                    in: [
                      AppointmentStatus.COMPLETED,
                      AppointmentStatus.CANCELLED,
                      AppointmentStatus.NO_SHOW,
                    ],
                  },
                },
              ],
            }
          : {};

    const rows = await this.prisma.appointment.findMany({
      where: { AND: [partyWhere, scopeWhere] },
      include: apptInclude,
      orderBy: { scheduledAt: scope === 'past' ? 'desc' : 'asc' },
      take: 100,
    });
    return rows.map((r) => this.toView(r));
  }

  async getOne(id: string, userId: string) {
    const row = await this.prisma.appointment.findUnique({ where: { id }, include: apptInclude });
    if (!row) throw AppException.notFound('Appointment not found');
    if (row.patientId !== userId && row.therapistId !== userId) throw AppException.forbidden();
    return this.toView(row);
  }

  async cancel(id: string, userId: string, reason: string | undefined, ctx: RequestContext) {
    const row = await this.prisma.appointment.findUnique({ where: { id } });
    if (!row) throw AppException.notFound('Appointment not found');
    if (row.patientId !== userId && row.therapistId !== userId) throw AppException.forbidden();
    if (
      row.status !== AppointmentStatus.SCHEDULED &&
      row.status !== AppointmentStatus.PENDING_PAYMENT
    ) {
      throw AppException.conflict('This appointment can no longer be cancelled');
    }

    await this.prisma.appointment.update({
      where: { id },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledById: userId,
        cancellationReason: reason ?? null,
      },
    });
    await this.reminders.cancelForAppointment(id);
    await this.audit.record({
      userId,
      action: 'appointment.cancel',
      resourceType: 'appointment',
      resourceId: id,
      ...ctx,
      metadata: { reason },
    });
    return this.getOne(id, userId);
  }

  private toView(row: AppointmentRow) {
    return {
      id: row.id,
      scheduledAt: row.scheduledAt.toISOString(),
      durationMins: row.durationMins,
      status: row.status,
      priceKsh: row.priceKsh,
      isFreeSession: row.isFreeSession,
      patientId: row.patientId,
      therapistId: row.therapistId,
      patient: {
        name: `${row.patient.firstName} ${row.patient.lastName}`.trim(),
      },
      therapist: {
        name: `${row.therapist.firstName} ${row.therapist.lastName}`.trim(),
        title: row.therapist.therapistProfile?.title ?? null,
      },
      payment: row.payment
        ? {
            status: row.payment.status,
            method: row.payment.method,
            amountKsh: row.payment.amountKsh,
          }
        : null,
      cancellationReason: row.cancellationReason,
    };
  }

  private async notifyFreeConfirmation(
    phone: string,
    firstName: string,
    when: Date,
  ): Promise<void> {
    const ts = when.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
    await this.notifications.sendSms({
      to: phone,
      body: `Hi ${firstName}, your free Suluhu session is confirmed for ${ts} EAT.`,
    });
  }
}

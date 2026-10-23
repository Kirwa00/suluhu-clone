import { AppointmentStatus, type AuthUser } from '@suluhu/shared';
import type { PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';
import type { AuditService } from './audit';
import type { RequestContext } from './types';
import type { VideoProvider } from './video-provider';

const JOIN_LEAD_MIN = 15; // patients/therapists may join 15 min early
const JOIN_GRACE_MIN = 15; // and up to 15 min after scheduled end

export type SessionPhase =
  | 'UNPAID'
  | 'EARLY'
  | 'WAITING' // patient is in the waiting room; therapist hasn't started
  | 'READY' // therapist can start
  | 'IN_SESSION'
  | 'ENDED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface SessionAccess {
  appointmentId: string;
  scheduledAt: string;
  durationMins: number;
  status: string;
  phase: SessionPhase;
  isOwner: boolean;
  counterpartName: string;
  canJoin: boolean;
  roomUrl?: string;
  token?: string;
  startsInMinutes?: number;
}

/** Video-session access/lifecycle — port of apps/api's SessionsService. */
export class SessionsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly video: VideoProvider,
  ) {}

  private async loadParty(appointmentId: string, userId: string) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
        therapist: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!appt) throw AppException.notFound('Appointment not found');
    if (appt.patientId !== userId && appt.therapistId !== userId) throw AppException.forbidden();
    return appt;
  }

  async getAccess(appointmentId: string, user: AuthUser): Promise<SessionAccess> {
    const appt = await this.loadParty(appointmentId, user.id);
    const isOwner = appt.therapistId === user.id;
    const counterpartName = isOwner
      ? `${appt.patient.firstName} ${appt.patient.lastName}`.trim()
      : `${appt.therapist.firstName} ${appt.therapist.lastName}`.trim();

    const base: SessionAccess = {
      appointmentId: appt.id,
      scheduledAt: appt.scheduledAt.toISOString(),
      durationMins: appt.durationMins,
      status: appt.status,
      phase: 'EARLY',
      isOwner,
      counterpartName,
      canJoin: false,
    };

    if (appt.status === AppointmentStatus.CANCELLED) return { ...base, phase: 'CANCELLED' };
    if (appt.status === AppointmentStatus.COMPLETED) return { ...base, phase: 'ENDED' };
    if (appt.status === AppointmentStatus.PENDING_PAYMENT) return { ...base, phase: 'UNPAID' };

    const now = Date.now();
    const start = appt.scheduledAt.getTime();
    const end = start + appt.durationMins * 60_000;
    const joinOpensAt = start - JOIN_LEAD_MIN * 60_000;
    const joinClosesAt = end + JOIN_GRACE_MIN * 60_000;

    if (now < joinOpensAt) {
      return { ...base, phase: 'EARLY', startsInMinutes: Math.ceil((start - now) / 60_000) };
    }
    if (now > joinClosesAt) {
      return { ...base, phase: 'EXPIRED' };
    }

    // Within the join window — ensure a room exists.
    const roomName = appt.videoRoomName ?? (await this.ensureRoom(appt.id));
    const ttlSeconds = Math.max(300, Math.ceil((joinClosesAt - now) / 1000));

    const inProgress = appt.status === AppointmentStatus.IN_PROGRESS;

    // Patient must wait until the therapist starts the session (waiting room).
    if (!isOwner && !inProgress) {
      return { ...base, phase: 'WAITING' };
    }

    const { token } = await this.video.createToken({
      roomName,
      userId: user.id,
      userName: isOwner ? base.counterpartName : 'Patient',
      isOwner,
      ttlSeconds,
    });
    const roomUrl = this.video.roomUrl(roomName);

    return {
      ...base,
      phase: inProgress ? 'IN_SESSION' : 'READY',
      canJoin: true,
      roomUrl,
      token,
    };
  }

  async start(appointmentId: string, user: AuthUser, ctx: RequestContext): Promise<SessionAccess> {
    const appt = await this.loadParty(appointmentId, user.id);
    if (appt.therapistId !== user.id) {
      throw AppException.forbidden('Only the therapist can start the session');
    }
    if (appt.status !== AppointmentStatus.SCHEDULED) {
      throw AppException.conflict('Session cannot be started in its current state');
    }
    const roomName = appt.videoRoomName ?? (await this.ensureRoom(appt.id));
    await this.prisma.appointment.update({
      where: { id: appt.id },
      data: {
        status: AppointmentStatus.IN_PROGRESS,
        startedAt: new Date(),
        videoRoomName: roomName,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: 'session.start',
      resourceType: 'appointment',
      resourceId: appt.id,
      ...ctx,
    });
    return this.getAccess(appointmentId, user);
  }

  async end(appointmentId: string, user: AuthUser, ctx: RequestContext): Promise<SessionAccess> {
    const appt = await this.loadParty(appointmentId, user.id);
    if (appt.therapistId !== user.id) {
      throw AppException.forbidden('Only the therapist can end the session');
    }
    if (
      appt.status !== AppointmentStatus.IN_PROGRESS &&
      appt.status !== AppointmentStatus.SCHEDULED
    ) {
      throw AppException.conflict('Session is not active');
    }
    await this.prisma.$transaction([
      this.prisma.appointment.update({
        where: { id: appt.id },
        data: { status: AppointmentStatus.COMPLETED, endedAt: new Date() },
      }),
      this.prisma.therapistProfile.updateMany({
        where: { userId: appt.therapistId },
        data: { sessionsCompleted: { increment: 1 } },
      }),
    ]);
    await this.audit.record({
      userId: user.id,
      action: 'session.end',
      resourceType: 'appointment',
      resourceId: appt.id,
      ...ctx,
    });
    return this.getAccess(appointmentId, user);
  }

  private async ensureRoom(appointmentId: string): Promise<string> {
    const room = await this.video.createRoom({ appointmentId });
    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { videoRoomName: room.roomName },
    });
    return room.roomName;
  }
}

import { AppointmentStatus, REMINDER_OFFSETS_MINUTES } from '@suluhu/shared';
import type { PrismaClient } from '../generated/prisma';
import type { NotificationsService } from './notifications';

export interface ReminderJobMessage {
  appointmentId: string;
  offsetMins: number;
}

/**
 * Appointment reminders — port of apps/api's RemindersService
 * (modules/notifications/reminders.service.ts), which schedules SMS
 * reminders at 24h/1h/15min before a session using BullMQ *delayed jobs*: a
 * job is enqueued the moment an appointment is confirmed, to fire itself
 * later.
 *
 * Cloudflare Queues has no delayed-job primitive with BullMQ's job-level
 * `delay` + stable `jobId` dedup, so the mechanism here is rebuilt around
 * the Cron Trigger already declared in wrangler.jsonc instead: every 5
 * minutes, `sweepDueReminders` scans for SCHEDULED appointments whose
 * 24h/1h/15min reminder instant just arrived and enqueues a message per
 * due reminder onto `REMINDERS_QUEUE`; the queue consumer
 * (`processReminderMessage`, called from `src/index.ts`'s `queue()`
 * handler) re-checks the appointment is still SCHEDULED (so a
 * cancellation between the sweep and the send is still honored) and sends.
 *
 * Because "due" is computed directly from `Appointment.scheduledAt` +
 * `.status` on every sweep, there is nothing to schedule or cancel ahead of
 * time — `scheduleForAppointment`/`cancelForAppointment` below are kept as
 * no-ops purely so `AppointmentsService`/`PaymentsService` don't need
 * restructuring; the next sweep tick (or its absence, for a cancelled
 * appointment) does the real work.
 */
export class RemindersService {
  constructor(private readonly prisma: PrismaClient) {}

  async scheduleForAppointment(_appointmentId: string, _scheduledAt: Date): Promise<void> {
    // No-op — see the class doc comment. The next cron sweep picks this
    // appointment up once it's within a reminder window, no scheduling step
    // needed.
  }

  async cancelForAppointment(_appointmentId: string): Promise<void> {
    // No-op — see the class doc comment. A cancelled appointment's status
    // no longer matches the sweep's `SCHEDULED` filter, and the queue
    // consumer re-checks status anyway before sending.
  }

  /**
   * Port of apps/api's `stats()` (BullMQ job counts: waiting/delayed/
   * active/completed/failed) adapted to this cron-sweep design, which has
   * no equivalent job-state machine to report on. Shape is deliberately
   * different — documented in the README — but answers the same
   * operational question ("is the reminder pipeline keeping up").
   */
  async stats(): Promise<{ sentLast24h: number; pendingInNext24h: number }> {
    const now = Date.now();
    const sentLast24h = await this.prisma.notification.count({
      where: {
        template: { startsWith: 'appointment_reminder_' },
        createdAt: { gte: new Date(now - 24 * 3600_000) },
      },
    });
    const pendingInNext24h = await this.prisma.appointment.count({
      where: {
        status: AppointmentStatus.SCHEDULED,
        scheduledAt: { gte: new Date(now), lte: new Date(now + 24 * 3600_000 + 5 * 60_000) },
      },
    });
    return { sentLast24h, pendingInNext24h };
  }
}

/** How far back a sweep tick looks — matches the cron schedule's own period. */
const SWEEP_WINDOW_MINUTES = 5;
/** How far back to check for an already-sent reminder, guarding overlapping sweep windows. */
const DEDUP_LOOKBACK_MS = 2 * 3600_000;

/**
 * Finds appointments whose next reminder instant (24h/1h/15min before
 * `scheduledAt`) falls in the window this sweep tick covers, and enqueues
 * one `REMINDERS_QUEUE` message per due reminder. Safe to call every 5
 * minutes from the Cron Trigger handler.
 */
export async function sweepDueReminders(
  prisma: PrismaClient,
  queue: Queue<ReminderJobMessage>,
): Promise<number> {
  const now = Date.now();
  let enqueued = 0;

  for (const offsetMins of REMINDER_OFFSETS_MINUTES) {
    const windowStart = new Date(now - SWEEP_WINDOW_MINUTES * 60_000 + offsetMins * 60_000);
    const windowEnd = new Date(now + offsetMins * 60_000);

    const due = await prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.SCHEDULED,
        scheduledAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, patientId: true },
    });
    if (due.length === 0) continue;

    const alreadySent = await prisma.notification.findMany({
      where: {
        template: `appointment_reminder_${offsetMins}m`,
        userId: { in: due.map((d) => d.patientId) },
        createdAt: { gte: new Date(now - DEDUP_LOOKBACK_MS) },
      },
      select: { payload: true },
    });
    const sentAppointmentIds = new Set(
      alreadySent
        .map((n) => (n.payload as { appointmentId?: string } | null)?.appointmentId)
        .filter((id): id is string => Boolean(id)),
    );

    for (const appt of due) {
      if (sentAppointmentIds.has(appt.id)) continue;
      await queue.send({ appointmentId: appt.id, offsetMins });
      enqueued += 1;
    }
  }

  return enqueued;
}

function reminderLabel(offsetMins: number): string {
  if (offsetMins >= 1440) return '24 hours';
  if (offsetMins >= 60) return '1 hour';
  return `${offsetMins} minutes`;
}

/**
 * Queue consumer — port of apps/api's `RemindersService.process()`. Skips a
 * no-longer-SCHEDULED appointment (cancelled, completed, etc. since the
 * sweep enqueued this message).
 */
export async function processReminderMessage(
  prisma: PrismaClient,
  notifications: NotificationsService,
  job: ReminderJobMessage,
): Promise<void> {
  const appt = await prisma.appointment.findUnique({
    where: { id: job.appointmentId },
    include: {
      patient: { select: { id: true, phone: true, firstName: true } },
      therapist: { select: { firstName: true, lastName: true } },
    },
  });
  if (!appt || appt.status !== AppointmentStatus.SCHEDULED) return;

  const when = appt.scheduledAt.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' });
  const label = reminderLabel(job.offsetMins);
  const body = `Reminder: your Suluhu session with ${appt.therapist.firstName} ${appt.therapist.lastName} is in ${label} (${when} EAT).`;

  await notifications.sendSms({ to: appt.patient.phone, body });
  await prisma.notification.create({
    data: {
      userId: appt.patient.id,
      channel: 'SMS',
      template: `appointment_reminder_${job.offsetMins}m`,
      status: 'SENT',
      sentAt: new Date(),
      payload: { appointmentId: appt.id, offsetMins: job.offsetMins },
    },
  });
  console.log(`Sent ${label} reminder for appointment ${appt.id}`);
}

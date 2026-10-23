import { AppointmentStatus, TherapistVerificationStatus, type SlotQuery } from '@suluhu/shared';
import type { PrismaClient } from '../generated/prisma';
import { AppException } from './app-exception';

/** All scheduling is East Africa Time (UTC+3). */
const EAT_OFFSET = '+03:00';

const BLOCKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING_PAYMENT,
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.IN_PROGRESS,
];

export interface DaySlots {
  date: string;
  slots: string[]; // ISO datetimes (UTC) of available starts
}

/**
 * Generates bookable time slots from a therapist's weekly availability minus
 * existing (blocking) appointments — port of apps/api's SlotsService. Times
 * are interpreted in EAT and returned as UTC instants.
 */
export class SlotsService {
  constructor(private readonly prisma: PrismaClient) {}

  async getSlots(therapistProfileId: string, query: SlotQuery): Promise<DaySlots[]> {
    const profile = await this.prisma.therapistProfile.findFirst({
      where: { id: therapistProfileId, deletedAt: null },
      include: { availability: { where: { isAvailable: true } } },
    });
    if (!profile || profile.verificationStatus !== TherapistVerificationStatus.APPROVED) {
      throw AppException.notFound('Therapist not available for booking');
    }

    const rangeStart = new Date(`${query.from}T00:00:00${EAT_OFFSET}`);
    const rangeEnd = new Date(`${query.to}T23:59:59${EAT_OFFSET}`);

    const booked = await this.prisma.appointment.findMany({
      where: {
        therapistId: profile.userId,
        status: { in: BLOCKING_STATUSES },
        scheduledAt: { gte: rangeStart, lte: rangeEnd },
      },
      select: { scheduledAt: true, durationMins: true },
    });
    const busy = booked.map((b) => ({
      start: b.scheduledAt.getTime(),
      end: b.scheduledAt.getTime() + b.durationMins * 60_000,
    }));

    const now = Date.now();
    const duration = query.durationMins;
    const results: DaySlots[] = [];

    for (const date of eachDate(query.from, query.to)) {
      const weekday = new Date(`${date}T12:00:00${EAT_OFFSET}`).getUTCDay();
      const windows = profile.availability.filter((a) => a.dayOfWeek === weekday);
      const slots: string[] = [];

      for (const w of windows) {
        const startMin = toMinutes(w.startTime);
        const endMin = toMinutes(w.endTime);
        for (let cursor = startMin; cursor + duration <= endMin; cursor += duration) {
          const startIso = `${date}T${fromMinutes(cursor)}:00${EAT_OFFSET}`;
          const startMs = new Date(startIso).getTime();
          const endMs = startMs + duration * 60_000;
          if (startMs <= now) continue; // no past slots
          const conflict = busy.some((b) => startMs < b.end && endMs > b.start);
          if (!conflict) slots.push(new Date(startMs).toISOString());
        }
      }

      if (slots.length > 0) results.push({ date, slots });
    }

    return results;
  }

  /** Confirms a specific start time is still a valid, free slot. */
  async isSlotAvailable(
    therapistProfileId: string,
    scheduledAtIso: string,
    durationMins: number,
  ): Promise<boolean> {
    const eatDate = new Date(new Date(scheduledAtIso).getTime() + 3 * 3600_000)
      .toISOString()
      .slice(0, 10);
    const days = await this.getSlots(therapistProfileId, {
      from: eatDate,
      to: eatDate,
      durationMins,
    });
    const target = new Date(scheduledAtIso).toISOString();
    return days.some((d) => d.slots.includes(target));
  }
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function* eachDate(from: string, to: string): Generator<string> {
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    yield cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

import { describe, expect, it, vi } from 'vitest';
import { sweepDueReminders, type ReminderJobMessage } from '../src/lib/reminders-service';
import type { PrismaClient } from '../src/generated/prisma';

/**
 * sweepDueReminders only calls `prisma.appointment.findMany` and
 * `prisma.notification.findMany`, so a minimal duck-typed fake (no real
 * Postgres/Hyperdrive connection) is enough to test its window math and
 * dedup logic — unlike most of this Worker's DB-touching code, which needs
 * a real Postgres connection `@cloudflare/vitest-plugin` can't provide (see
 * the README's "Known limitation").
 */
function fakePrisma(opts: {
  appointments?: { id: string; patientId: string }[];
  alreadySent?: { payload: unknown }[];
}): PrismaClient {
  return {
    appointment: {
      findMany: vi.fn().mockResolvedValue(opts.appointments ?? []),
    },
    notification: {
      findMany: vi.fn().mockResolvedValue(opts.alreadySent ?? []),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function fakeQueue() {
  const sent: ReminderJobMessage[] = [];
  return {
    send: vi.fn(async (msg: ReminderJobMessage) => {
      sent.push(msg);
    }),
    sent,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('sweepDueReminders', () => {
  it('enqueues one message per due appointment per offset', async () => {
    const prisma = fakePrisma({
      appointments: [
        { id: 'appt-1', patientId: 'patient-1' },
        { id: 'appt-2', patientId: 'patient-2' },
      ],
    });
    const queue = fakeQueue();

    const count = await sweepDueReminders(prisma, queue);

    // Three offsets (24h/1h/15min) each query the same fake appointment
    // list, so two appointments land once per offset = 6 total.
    expect(count).toBe(6);
    expect(queue.sent).toHaveLength(6);
    expect(queue.sent).toEqual(
      expect.arrayContaining([
        { appointmentId: 'appt-1', offsetMins: 1440 },
        { appointmentId: 'appt-1', offsetMins: 60 },
        { appointmentId: 'appt-1', offsetMins: 15 },
        { appointmentId: 'appt-2', offsetMins: 1440 },
      ]),
    );
  });

  it('skips an appointment whose reminder was already sent for that offset', async () => {
    const prisma = fakePrisma({
      appointments: [{ id: 'appt-1', patientId: 'patient-1' }],
      alreadySent: [{ payload: { appointmentId: 'appt-1' } }],
    });
    const queue = fakeQueue();

    const count = await sweepDueReminders(prisma, queue);

    // Every offset's dedup check returns the same "already sent" row here,
    // so nothing is enqueued for any of the three offsets.
    expect(count).toBe(0);
    expect(queue.sent).toHaveLength(0);
  });

  it('does not query notifications when no appointments are due for an offset', async () => {
    const prisma = fakePrisma({ appointments: [] });
    const queue = fakeQueue();

    await sweepDueReminders(prisma, queue);

    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });
});

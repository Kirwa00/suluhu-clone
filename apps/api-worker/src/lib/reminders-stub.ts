/**
 * Interim stand-in for apps/api's `RemindersService`
 * (modules/notifications/reminders.service.ts), which schedules SMS/email
 * reminders at 24h/1h/15min before a session using BullMQ delayed jobs.
 *
 * Real reminder delivery is explicitly Phase 5 scope (see the delivery plan
 * and `src/index.ts`'s `queue()`/`scheduled()` handlers, which already
 * no-op pending that phase) — this stub exists only so Phase 4's
 * appointments/payments services, which call it on booking/cancellation,
 * have something to call. It intentionally does nothing: no reminder is
 * silently dropped that Phase 5 was ever going to deliver, since the real
 * Cloudflare Queues-backed implementation replaces this file wholesale.
 */
export class RemindersStub {
  async scheduleForAppointment(appointmentId: string, _scheduledAt: Date): Promise<void> {
    console.log(`Reminders: would schedule for appointment ${appointmentId} (Phase 5 — no-op)`);
  }

  async cancelForAppointment(appointmentId: string): Promise<void> {
    console.log(`Reminders: would cancel for appointment ${appointmentId} (Phase 5 — no-op)`);
  }
}

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './env';
import { validateEnv } from './env';
import { requestId } from './middleware/request-id';
import { accessLog } from './middleware/logging';
import { withAuthContext } from './middleware/with-context';
import { onError } from './lib/error-handler';
import { createPrismaClient } from './db/prisma';
import { createNotificationsService } from './lib/notifications';
import {
  processReminderMessage,
  sweepDueReminders,
  type ReminderJobMessage,
} from './lib/reminders-service';
import { errorEnvelope } from './lib/response';
import { health } from './routes/health';
import { auth } from './routes/auth';
import { users } from './routes/users';
import { therapists } from './routes/therapists';
import { admin } from './routes/admin';
import { intake } from './routes/intake';
import { appointments } from './routes/appointments';
import { payments } from './routes/payments';
import { conversations } from './routes/messaging';
import { mood } from './routes/mood';
import { content } from './routes/content';
import { clinical } from './routes/clinical';
import { therapist } from './routes/therapist';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

app.use('*', requestId());
app.use('*', accessLog());

// Same allow-list as apps/api's app.enableCors() (main.ts): the two
// production domains, the apex-redirect domain, and local dev. Exposes
// Content-Disposition for therapist document downloads (Phase 3).
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowed = c.env.CORS_ORIGINS.split(',')
        .map((o: string) => o.trim())
        .filter(Boolean);
      return origin && allowed.includes(origin) ? origin : undefined;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Disposition'],
  }),
);

// Fail fast on a misconfigured Worker — same posture as apps/api's env
// validation refusing to boot, adapted to the per-request Workers model
// (there's no persistent boot phase to fail during). Stored on the context
// so downstream middleware (withAuthContext) doesn't re-parse it.
app.use('*', async (c, next) => {
  c.set('validatedEnv', validateEnv(c.env as unknown as Record<string, unknown>));
  await next();
});

app.onError(onError);
app.notFound((c) =>
  c.json(errorEnvelope('NOT_FOUND', 'Resource not found', c.get('requestId')), 404),
);

const api = new Hono<AppEnv>();
api.route('/health', health);

// All of these need the request-scoped service graph (Prisma, tokens,
// otp, therapists, ...) — built once per request here, reused by every
// route and by requireAuth()/requireRole() on the protected ones. Payments'
// two callback routes are public (no requireAuth), but still need `ctx` to
// reach PaymentsService.
api.use('/auth/*', withAuthContext());
api.use('/users/*', withAuthContext());
api.use('/therapists/*', withAuthContext());
api.use('/admin/*', withAuthContext());
api.use('/intake/*', withAuthContext());
api.use('/appointments/*', withAuthContext());
api.use('/payments/*', withAuthContext());
api.use('/conversations/*', withAuthContext());
api.use('/mood/*', withAuthContext());
api.use('/content/*', withAuthContext());
api.use('/clinical-notes/*', withAuthContext());
api.use('/treatment-plans/*', withAuthContext());
api.use('/patients/*', withAuthContext());
api.use('/clinical/*', withAuthContext());
api.use('/therapist/*', withAuthContext());
api.route('/auth', auth);
api.route('/users', users);
api.route('/therapists', therapists);
api.route('/admin', admin);
api.route('/intake', intake);
api.route('/appointments', appointments);
api.route('/payments', payments);
api.route('/conversations', conversations);
api.route('/mood', mood);
api.route('/content', content);
// ClinicalController in apps/api has no @Controller() prefix — its routes
// (clinical-notes/*, treatment-plans, patients/*, clinical/clients) are
// each already fully-qualified, so this mounts at the api root.
api.route('/', clinical);
api.route('/therapist', therapist);

app.route('/api/v1', api);

export default {
  fetch: app.fetch,

  // Consumer for the `suluhu-reminders` queue (wrangler.jsonc) — port of
  // apps/api's RemindersService.process(), one message per due reminder.
  // Each message is acked or retried individually so one bad appointment
  // lookup doesn't block the rest of the batch; wrangler.jsonc caps retries
  // at 3 (max_retries), matching the queue's own dead-letter-free config.
  async queue(
    batch: MessageBatch<ReminderJobMessage>,
    env: Bindings,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const prisma = await createPrismaClient(env);
    const notifications = createNotificationsService(env);
    for (const message of batch.messages) {
      try {
        await processReminderMessage(prisma, notifications, message.body);
        message.ack();
      } catch (error) {
        console.error(
          `Failed to process reminder for appointment ${message.body.appointmentId} (offset ${message.body.offsetMins}m): ${
            error instanceof Error ? error.stack : String(error)
          }`,
        );
        message.retry();
      }
    }
  },

  // Reminder-sweep cron trigger (wrangler.jsonc, every 5 minutes) — port of
  // the scheduling half of apps/api's RemindersService; see
  // lib/reminders-service.ts for why this replaces BullMQ delayed jobs.
  async scheduled(
    controller: ScheduledController,
    env: Bindings,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const prisma = await createPrismaClient(env);
    const enqueued = await sweepDueReminders(prisma, env.REMINDERS_QUEUE);
    console.log(`Reminder sweep (cron: ${controller.cron}) enqueued ${enqueued} reminder(s)`);
  },
};

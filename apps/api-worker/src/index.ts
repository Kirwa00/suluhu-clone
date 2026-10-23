import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings } from './env';
import { validateEnv } from './env';
import type { RequestIdVariables } from './middleware/request-id';
import { requestId } from './middleware/request-id';
import { accessLog } from './middleware/logging';
import { onError } from './lib/error-handler';
import { errorEnvelope } from './lib/response';
import { health } from './routes/health';

type AppEnv = { Bindings: Bindings; Variables: RequestIdVariables };

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
// (there's no persistent boot phase to fail during).
app.use('*', async (c, next) => {
  validateEnv(c.env as unknown as Record<string, unknown>);
  await next();
});

app.onError(onError);
app.notFound((c) =>
  c.json(errorEnvelope('NOT_FOUND', 'Resource not found', c.get('requestId')), 404),
);

const api = new Hono<AppEnv>();
api.route('/health', health);

app.route('/api/v1', api);

export default {
  fetch: app.fetch,

  // Placeholder consumer for the `suluhu-reminders` queue (wrangler.jsonc).
  // Reminder delivery lands in Phase 5; until then, every message is
  // acknowledged as a safe no-op rather than left to retry indefinitely.
  async queue(batch: MessageBatch, _env: Bindings, _ctx: ExecutionContext): Promise<void> {
    console.warn(
      `suluhu-reminders: ${batch.messages.length} message(s) received before Phase 5 wiring — acking as no-op`,
    );
    batch.ackAll();
  },

  // Placeholder for the reminder-sweep cron trigger (wrangler.jsonc). Wired
  // for real in Phase 5 (reminders.service.ts port).
  async scheduled(
    controller: ScheduledController,
    _env: Bindings,
    _ctx: ExecutionContext,
  ): Promise<void> {
    console.log(`Scheduled trigger fired (cron: ${controller.cron}) — no-op before Phase 5 wiring`);
  },
};

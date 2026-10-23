import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createPrismaClient } from '../db/prisma';
import type { Bindings } from '../env';
import { successEnvelope } from '../lib/response';
import type { AppEnv } from '../types';

type ComponentStatus = 'up' | 'down';

interface HealthReport {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  components: Record<string, { status: ComponentStatus; latencyMs?: number; error?: string }>;
}

/**
 * Module-scope `Date.now()` is unreliable in Workers — it's frozen to a
 * stale/arbitrary value outside request-handling I/O (a Spectre mitigation),
 * so timing "isolate age" from module load produces nonsense deltas. There's
 * no Worker-wide process to measure uptime against anyway (isolates are
 * recycled independently, possibly per-request in dev); `0` is kept rather
 * than a misleading number, just to keep the field present for clients that
 * expect the same shape as apps/api's health report.
 */
const UPTIME_NOT_APPLICABLE = 0;

async function checkDatabase(env: Bindings): Promise<HealthReport['components']['database']> {
  const start = Date.now();
  try {
    const prisma = await createPrismaClient(env);
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (error) {
    return { status: 'down', error: (error as Error).message };
  }
}

/**
 * Kubernetes-style probes, same shape as apps/api/src/health — minus the
 * Redis component (there's no Redis in this Worker):
 *   • GET /health       — full component report
 *   • GET /health/live  — liveness (process is up)
 *   • GET /health/ready — readiness (dependencies reachable)
 */
export const health = new Hono<AppEnv>();

health.get('/', async (c) => {
  const database = await checkDatabase(c.env);
  const components = { database };
  const allUp = Object.values(components).every((comp) => comp.status === 'up');
  const report: HealthReport = {
    status: allUp ? 'ok' : 'degraded',
    uptimeSeconds: UPTIME_NOT_APPLICABLE,
    components,
  };
  return c.json(successEnvelope(report, c.get('requestId')));
});

health.get('/live', (c) => c.json(successEnvelope({ status: 'alive' }, c.get('requestId'))));

health.get('/ready', async (c) => {
  const database = await checkDatabase(c.env);
  if (database.status !== 'up') {
    throw new HTTPException(503, { message: 'Dependencies not ready' });
  }
  return c.json(successEnvelope({ status: 'ready' }, c.get('requestId')));
});

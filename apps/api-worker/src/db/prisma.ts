import type { PrismaClient as PrismaClientType } from '../generated/prisma';
import type { Bindings } from '../env';

/**
 * Creates a Prisma client over the pooled Neon connection, reached through
 * the Hyperdrive binding. One client per request — not a module-level
 * singleton — per Cloudflare's and Prisma's guidance for Workers: Hyperdrive
 * (not the Worker) owns connection pooling, and a request-scoped client
 * avoids holding state across isolate reuse between unrelated requests.
 *
 * `pg`/`@prisma/adapter-pg`/the generated client are imported lazily so that
 * a route never touching the database doesn't pay for loading them — and so
 * that merely importing this module (e.g. the Worker's module graph at
 * startup) doesn't eagerly load `pg`.
 */
export async function createPrismaClient(env: Bindings): Promise<PrismaClientType> {
  const [{ PrismaPg }, { PrismaClient }] = await Promise.all([
    import('@prisma/adapter-pg'),
    import('../generated/prisma'),
  ]);
  const adapter = new PrismaPg({ connectionString: env.HYPERDRIVE.connectionString });
  return new PrismaClient({ adapter });
}

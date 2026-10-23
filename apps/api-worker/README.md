# @suluhu/api-worker

Cloudflare Workers port of the Suluhu Therapy Center API — same `/api/v1/...`
HTTP contract as `apps/api` (NestJS), running on Hono + Prisma (driver
adapters) + Cloudflare bindings instead of Express + raw Postgres/Redis
connections. See the root `CLAUDE.md` / `Suluhu_Therapy_Center_SDLC_Documentation.md`
for product context.

**Status: Phase 1 (Foundation) only.** `apps/api` is still the real backend —
`apps/web`'s `NEXT_PUBLIC_API_URL` has not changed. This Worker currently
exposes only `/api/v1/health`, `/health/live`, `/health/ready`. Auth,
therapists, payments, etc. land in later phases (see the delivery plan in the
PR/issue this shipped from).

## Why a second Prisma major version

`apps/api/prisma/schema.prisma` is the single source of truth and is
**shared, unmodified in substance** — this workspace adds a second
`generator` block to it (`apiWorkerClient`) rather than forking the schema.
Prisma driver adapters (`@prisma/adapter-pg`, needed for Hyperdrive) became
stable (no `previewFeatures` flag) in Prisma 6.6+, so this workspace pins its
own `prisma`/`@prisma/client`/`@prisma/adapter-pg` to **6.19.3** —
independent of `apps/api`'s pinned **5.20.0**. (Prisma 7 was tried first and
rejected: it removes inline `datasource { url }` entirely in favor of
`prisma.config.ts`, which would force forking the schema to upgrade just this
workspace — not worth it yet.)

Two things make the two generators coexist safely in one file:

1. **`prisma/schema.prisma` here is a symlink** to `../api/prisma/schema.prisma`
   (`git`-tracked as a real symlink, not a copy). Prisma's CLI resolves
   `@prisma/client` relative to the schema file's own directory — pointing it
   at a path *inside* this workspace is what makes `prisma generate` pick up
   *this* workspace's nested Prisma 6.19.3 install instead of the monorepo
   root's 5.20.0 (hoisted for `apps/api`).
2. **Every `prisma generate` invocation is scoped with `--generator`** —
   `apps/api`'s scripts generate `--generator client` only, this workspace's
   `db:generate` generates `--generator apiWorkerClient` only. Without this,
   whichever CLI version runs last would regenerate *both* blocks and corrupt
   the other app's client (a real failure mode hit while building this: a
   bare `prisma generate` from either app silently overwrites the other's
   generated client with the wrong major version's codegen).

Regenerate after a schema change: `npm run -w @suluhu/api-worker db:generate`.

## Local development

```bash
cd apps/api-worker
cp .dev.vars.example .dev.vars   # fill in JWT secrets + PHI key (see below)
npm run db:generate
npm run dev                       # wrangler dev, http://localhost:8787
```

`wrangler dev` reads the `localConnectionString` already set on the
`HYPERDRIVE` binding in `wrangler.jsonc` — point it at your local Postgres
(same one `docker compose up -d postgres` brings up for `apps/api`; the
default there — `suluhu`/`suluhu_dev_password`/`suluhu` — matches, just
change the database name to one with the schema migrated, e.g. run
`apps/api`'s migrations against it first: `npm run -w @suluhu/api db:migrate`).

### Generating `.dev.vars` secrets

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET / JWT_REFRESH_SECRET
openssl rand -base64 32   # PHI_ENCRYPTION_KEY
```

Use the **same** `PHI_ENCRYPTION_KEY` as `apps/api` if you need PHI encrypted
by one to decrypt on the other (relevant once Phase 5 clinical data ports
over) — see `apps/api/src/common/crypto/phi-crypto.service.ts`.

## Testing

```bash
npm run test       # vitest, via @cloudflare/vitest-plugin (runs in workerd/Miniflare)
npm run typecheck
npm run lint
```

**Known limitation:** `test/health-db.spec.ts` is `describe.skip`'d —
`@prisma/adapter-pg`'s `pg` dependency fails to load inside this specific
test harness (`@cloudflare/vitest-plugin`'s Vite-based module runner throws a
CJS/ESM interop error on `pg/lib/connection.js`). This was verified to be a
test-harness-only issue, not a real bug: `wrangler dev` against a real local
Postgres serves `GET /api/v1/health` with `database.status: "up"` correctly
(and so will production, going through Hyperdrive). Re-run that check by
hand after any `@cloudflare/vitest-plugin` or `pg` upgrade, and unskip the
test once it passes.

## Deploying

Cloudflare Workers Builds (recommended — fires on push, like the existing
`apps/web` deploy):

- **Root directory:** `/` (repo root — needs the monorepo's workspaces)
- **Build command:** `cd apps/api-worker && npm run build`
- **Deploy command:** `cd apps/api-worker && npx wrangler deploy`
- **Environment variable:** `NODE_VERSION=22` (wrangler 4 requires Node ≥22)

Or manually from a machine with Cloudflare credentials:

```bash
cd apps/api-worker
npx wrangler login
npm run deploy      # wrangler deploy
```

### One-time setup (do this before the first deploy)

1. **Neon Postgres.** Create a project, region closest to Kenya (Frankfurt —
   `eu-central-1`). Grab both the **pooled** connection string (for
   Hyperdrive) and the **direct** one (for migrations — same `DIRECT_URL`
   `apps/api` already uses, since they share one database).

2. **Hyperdrive**, over the *pooled* Neon string:

   ```bash
   npx wrangler hyperdrive create suluhu-api-db --connection-string="postgresql://...neon pooled url.../suluhu?sslmode=require"
   ```

   Copy the returned id into `wrangler.jsonc`'s `hyperdrive[0].id`
   (replacing `REPLACE_WITH_HYPERDRIVE_CONFIG_ID`).

3. **R2 bucket** (Phase 3, therapist documents — declared now so the binding
   exists from day one):

   ```bash
   npx wrangler r2 bucket create suluhu-documents
   ```

4. **Queue** (Phase 5, reminders):

   ```bash
   npx wrangler queues create suluhu-reminders
   ```

5. **Secrets** — every one of these via `wrangler secret put <NAME>` (run
   from `apps/api-worker/`):

   | Secret                  | Notes                                               |
   | ------------------------ | ---------------------------------------------------- |
   | `JWT_ACCESS_SECRET`      | Same value as `apps/api`'s, until cutover            |
   | `JWT_REFRESH_SECRET`     | Same value as `apps/api`'s, until cutover            |
   | `PHI_ENCRYPTION_KEY`     | Same value as `apps/api`'s — required for byte-compatible decryption |
   | `PAYHERO_API_USERNAME`   | Only once `MPESA_MODE=live`                          |
   | `PAYHERO_API_PASSWORD`   | Only once `MPESA_MODE=live`                          |
   | `PAYHERO_CHANNEL_ID`     | Only once `MPESA_MODE=live`                          |
   | `MPESA_CALLBACK_URL`     | Only once `MPESA_MODE=live`                          |
   | `DAILY_API_KEY`          | Only once `VIDEO_MODE=live`                          |
   | `DAILY_DOMAIN`           | Only once `VIDEO_MODE=live`                          |
   | `AT_USERNAME`            | Only once `SMS_MODE=live`                            |
   | `AT_API_KEY`             | Only once `SMS_MODE=live`                            |
   | `RESEND_API_KEY`         | Only once `EMAIL_MODE=live` (Resend HTTP API, not SMTP) |
   | `GOOGLE_CLIENT_ID`       | Only if Sign in with Google is enabled               |

   Flip the `*_MODE` vars themselves in `wrangler.jsonc`'s `vars` block (they're
   non-secret) once you're ready to go live with a given provider.

6. **Custom domain.** First `wrangler deploy` with the `routes` entry in
   `wrangler.jsonc` (`api.suluhutherapy.com`) creates the DNS record and
   certificate automatically, same as `apps/web`'s `suluhutherapy.com` — see
   `apps/web/CLOUDFLARE.md` for the general pattern. Delete any existing
   A/CNAME for that hostname first if one exists.

## Bindings reference (`wrangler.jsonc`)

| Binding                  | Type       | Used by          |
| ------------------------- | ---------- | ----------------- |
| `HYPERDRIVE`              | Hyperdrive | Phase 1 (health, then everything DB-backed) |
| `DOCUMENTS`                | R2 Bucket  | Phase 3 (therapist documents) |
| `REMINDERS_QUEUE`          | Queue      | Phase 5 (reminders) |
| `RATE_LIMITER_STRICT`      | Rate Limit | Phase 2 (auth login/OTP/MFA — 10/min) |
| `RATE_LIMITER_STANDARD`    | Rate Limit | Phase 2 (`/auth/me`, `/auth/refresh` — 100/min) |

`queue()` and `scheduled()` handlers in `src/index.ts` are no-op placeholders
today (they ack/log and return) so the Worker is valid and deployable before
Phases 2–5 land — nothing is silently dropped, there's just nothing to do
with it yet.

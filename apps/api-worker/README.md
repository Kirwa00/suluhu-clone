# @suluhu/api-worker

Cloudflare Workers port of the Suluhu Therapy Center API — same `/api/v1/...`
HTTP contract as `apps/api` (NestJS), running on Hono + Prisma (driver
adapters) + Cloudflare bindings instead of Express + raw Postgres/Redis
connections. See the root `CLAUDE.md` / `Suluhu_Therapy_Center_SDLC_Documentation.md`
for product context.

**Status: Phases 1–5 (Foundation; Auth & users; Therapists & admin; Care
flow; Messaging, mood, content, clinical, analytics & payouts).**
`apps/api` is still the real backend — `apps/web`'s `NEXT_PUBLIC_API_URL`
has not changed. This Worker now exposes the full `/api/v1/...` surface:
health, auth/users, therapist onboarding + discovery, admin approval +
clinical alerts, intake & triage, booking + appointments, video sessions,
M-Pesa payments, secure patient-therapist messaging, the mood journal,
psychoeducation content (public + admin-authored), SOAP clinical notes +
treatment plans + the aggregated patient health record (all PHI-encrypted
and ABAC-gated), and admin analytics/revenue/payouts + the audit-log
viewer. Appointment reminders are real too, just delivered differently
than apps/api — see "Reminders" below. Only Phase 6 (cutover) remains.

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

For the same reason, every auth/users flow that touches the database
(register, login, refresh rotation, OTP, password reset/change, profile
updates) is verified by hand via `wrangler dev` against local Postgres
rather than by a Vitest integration test — see the Phase 2 PR description for
the full manual test transcript (register → MFA → verify → refresh → reuse
detection → logout → revoked-token rejection, password forgot/reset,
duplicate-email conflict, validation errors, per-route rate limiting). What
*is* covered in Vitest: byte-for-byte PHI-encryption and password-hash
cross-compatibility against fixtures captured from apps/api's actual (Node)
implementations, JWT sign/verify/blocklist (no DB needed), and rate-limiter
isolation.

Phase 3's therapist/admin routes are all DB-backed too, so the same split
applies: `test/cpb-verification.spec.ts`, `test/require-role.spec.ts`, and
`test/document-storage.spec.ts` cover the pure/R2-only logic in Vitest (R2
itself *does* run fine in this harness, unlike `pg`); every route that also
touches Postgres (credentials submission, onboarding, availability, document
upload/list/download, discovery search/detail, admin application
review/approval, clinical alerts) was verified by hand via `wrangler dev`
against local Postgres — therapist registration → credentials submission
(including the mock CPB check) → availability → document upload → owner
download (200) → cross-role download attempts (403 for a patient, 401 for
no token) → admin list/detail/approve → discovery search/detail before and
after approval (confirming the `verificationStatus=APPROVED` +
`user.status=ACTIVE` gate) → clinical alerts list/count. See the Phase 3 PR
description for the full transcript.

## Auth & users (Phase 2) — what to know

- **Password hashing**: `bcryptjs` (pure JS) instead of native `bcrypt` —
  same `$2b$` hash format, same cost factor; existing `apps/api` password
  hashes verify here unchanged (and vice versa), confirmed in
  `test/password.spec.ts` against a hash produced by real `bcrypt`.
- **PHI encryption** (`dateOfBirth` on `/users/me`): WebCrypto AES-256-GCM,
  byte-compatible with `apps/api`'s `node:crypto` implementation — same
  `v1.<iv>.<tag>.<data>` format, confirmed in `test/phi-crypto.spec.ts`
  against ciphertext produced by the real Node service.
- **JWTs**: `jose` instead of `@nestjs/jwt`, same secrets/claims/expiries
  (HS256). Refresh tokens are still opaque, hashed, DB-rotated values — not
  JWTs — exactly as in `apps/api`.
- **Access-token revocation** (logout): a KV-backed blocklist
  (`AUTH_KV`, key `access:<jti>`) replaces the Redis one, same fail-open
  posture (a KV outage never blocks an otherwise-valid request).
- **Google sign-in**: `jose`'s `createRemoteJWKSet` against Google's JWKS
  instead of `google-auth-library` (which needs Node and can't run on
  Workers) — same checks (`aud`, `iss`, `exp`, `email_verified`).
- **Rate limiting**: one Workers Rate Limiting binding **per route**,
  keyed by client IP — see the bindings table below for why one-per-*value*
  wasn't enough (Nest's default tracker keys per-route, not just per limit
  value, so e.g. `/auth/login` and `/auth/mfa/verify` have independent 5/min
  budgets even though they share the same limit).
- **OTP issuance throttle** (3 codes per 15 min per user+purpose — a
  *different* check from the per-route HTTP rate limit above): a
  read-then-write counter in `AUTH_KV`, since the Rate Limiting binding's
  `period` only accepts 10 or 60 seconds. Best-effort under concurrent
  requests (KV has no atomic increment) — same risk class as the fail-open
  blocklist above, and the consequence of losing the race is a slightly
  looser anti-abuse limit, never a security hole.
- **Deliberate deviation**: apps/api's test-only `GET /auth/test/otp`
  additionally 404s unless `NODE_ENV==='test'`. There's no Workers
  equivalent to key that off of, and it's redundant with the real safety
  boundary (`getLastMockMessage` only returns a value when the configured
  provider is actually the mock one) — so that extra gate isn't reproduced
  here. Still rate-limited (`RATE_LIMITER_AUTH_TEST_OTP`), same as `apps/api`.

## Therapists & admin (Phase 3) — what to know

- **R2 instead of local disk**: `R2DocumentStorageService` (`src/lib/
  document-storage.ts`) replaces apps/api's `LocalDocumentStorageService` —
  same opaque key format (`<therapistProfileId>/<uuid>-<sanitized-filename>`,
  stored verbatim in `TherapistDocument.url`), same filename sanitizing. The
  local-disk version validated the key to block path traversal outside its
  root directory; R2 keys aren't filesystem paths, so that risk doesn't
  exist here — the same key-shape check is kept anyway as a data-integrity
  invariant (a key that doesn't match what `save()` ever produces means the
  DB row was corrupted or tampered with).
- **Multipart upload**: apps/api used `multer` (`FileInterceptor` +
  `memoryStorage()`); Hono has no direct equivalent, so `routes/
  therapists.ts` reads the upload via the Web-standard `c.req.formData()`
  and does the same size (10MB) and MIME-type (`application/pdf`,
  `image/jpeg`, `image/png`) checks `ParseFilePipe`'s validators did.
- **CPB license verification**: still mock-only on both backends — no live
  CPB-portal integration exists yet. `createAuthContext` logs the same
  warning apps/api's `TherapistsModule` factory does if `PROVIDER_MODE`
  is ever set to `live`.
- **RBAC**: `requireRole(...)` (`src/middleware/require-role.ts`) is a new
  per-route port of apps/api's `RolesGuard` (Phase 2 only needed
  `requireAuth()` — no route was role-restricted beyond "any authenticated
  user"). Always chained *after* `requireAuth()` and *after* `rateLimit(...)`
  on each route, never as a blanket `.use()` — see the comment in
  `routes/admin.ts` for why a blanket guard would reverse the
  throttle → authenticate → authorize order apps/api's guards run in.
- **Discovery is authenticated but unrestricted by role**: `GET /therapists`
  and `GET /therapists/:id` have no apps/api `@Roles(...)` — they're reached
  by any authenticated user (patients, mainly), just still behind
  `requireAuth()` like every non-`@Public()` apps/api route.
- **Document download is ownership-*or*-role gated**: `GET /therapists/
  documents/:id/download` first requires the THERAPIST/ADMIN/SUPER_ADMIN
  role (`requireRole`), then the service layer separately checks the
  requester either owns the document's therapist profile or holds an admin
  role — same two-layer check as apps/api's `TherapistDocumentsService
  .download()`.
- **Rate limiting**: none of these controllers carry an explicit
  `@Throttle(...)` in apps/api, so all 16 new routes use the same global
  default (100/min) as `RATE_LIMITER_AUTH_REFRESH` — still one binding
  *per route*, for the same per-route-tracker reason as Phase 2.

## Care flow (Phase 4) — what to know

- **Scope note — no payouts to port**: the delivery plan lists "payouts"
  under this phase, but apps/api has no payout service or controller to
  port — `Payout` is a bare Prisma model, written nowhere and read only by
  apps/api's (not-yet-ported, Phase 5) analytics module for reporting.
  There's nothing to port here; this is a deliberate scope reduction, not
  an oversight.
- **Reminders are a documented no-op stub**: `AppointmentsService` and
  `PaymentsService` both call apps/api's `RemindersService` on
  booking/payment-confirmation/cancellation to schedule or cancel SMS/email
  reminders. That service is BullMQ-backed and squarely Phase 5 scope
  (Cloudflare Queues + Cron, same as `src/index.ts`'s already-declared
  `queue()`/`scheduled()` placeholders). `src/lib/reminders-stub.ts` is a
  trivial stand-in with the same two methods, intentionally doing nothing —
  no reminder is silently dropped that Phase 5 was ever going to send, and
  this file is replaced wholesale once Phase 5 wires the real thing.
- **Mock M-Pesa confirms synchronously, not after a simulated delay**:
  apps/api's `MockMpesaProvider.initiateStkPush` uses `setTimeout(..., 2000)`
  to simulate the customer approving the STK prompt ~2s later, relying on
  that delay to land *after* `PaymentsService.initiateMpesa` has persisted
  the checkout id Daraja/PayHero would have returned. A Worker's execution
  context isn't guaranteed to run a bare `setTimeout` past the response, so
  `src/lib/mpesa-provider.ts`'s mock splits the step instead:
  `initiateStkPush` only returns the push result, and a separate
  `simulateCallback(checkoutRequestId)` — called by `PaymentsService`
  immediately after it persists that id — does the confirming. Same
  ordering guarantee, no timer dependency; a booking request in mock mode
  now returns with the payment already `SUCCEEDED` instead of `PROCESSING`.
- **PayHero / Daraja / Daily**: `PayHeroProvider`, `DailyVideoProvider` are
  byte-for-byte ports of apps/api's, with `node:crypto`'s `randomBytes`/
  `Buffer` swapped for WebCrypto (`crypto.getRandomValues` via the new
  `randomHex`/`utf8ToBase64`/`utf8ToBase64Url` helpers in `src/lib/
  crypto.ts`) — same request/response shapes, same defensive PayHero
  callback-field-name parsing.
- **Callback webhooks are public but still rate-limited**: `POST /payments/
  mpesa/callback` and `POST /payments/payhero/callback` skip `requireAuth()`
  (same as apps/api's `@Public()`) but still go through `rateLimit(...)` —
  apps/api's global guard order is throttle → authenticate → authorize, and
  `@Public()` only opts out of the second step.
- **Rate limiting**: same story as Phases 2–3 — none of these controllers
  carry an explicit `@Throttle(...)` in apps/api, so all 14 new routes use
  the global default (100/min), one binding per route.

**Known limitation, extended**: every Phase 4 route that touches the
database (intake submit/latest/history, booking slots, appointment create/
list/detail/cancel, session access/start/end, both payment callbacks,
payment status) was verified by hand via `wrangler dev` against local
Postgres rather than by a Vitest integration test, for the same `pg`-in-
Miniflare reason as Phases 1–3. What *is* covered in Vitest: PayHero
callback parsing (documented PascalCase shape, flattened snake_case
variant, status-string fallback), Kenyan phone normalization, the mock
M-Pesa provider's initiate/confirm ordering, and the mock video provider's
room/token shape plus `normalizeDailyDomain`. See the Phase 4 PR
description for the full manual test transcript (therapist onboarding →
approval → availability; patient intake, including a crisis-flagged
submission creating a `ClinicalAlert` and notifying admins; slots → paid
booking → mock M-Pesa confirmation → confirmation SMS/email → payment
status; a free-session booking consuming the per-patient quota and a
second booking correctly falling back to paid; cross-party/cross-role
access checks on appointments and session start/end; both callback
webhooks safely no-opping on an unknown checkout id).

## Messaging, mood, content, clinical, analytics & payouts (Phase 5) — what to know

- **Reminders are real now, delivered differently than apps/api**:
  apps/api's `RemindersService` schedules SMS reminders (24h/1h/15min
  before a session) as BullMQ *delayed jobs* — one job enqueued the moment
  an appointment is confirmed, carrying its own fire time. Cloudflare
  Queues has no equivalent (no job-level delay + stable dedup key), so
  `src/lib/reminders-service.ts` rebuilds this around the Cron Trigger
  already declared in `wrangler.jsonc` instead: every 5 minutes,
  `sweepDueReminders` scans for `SCHEDULED` appointments whose next
  reminder instant just arrived and enqueues one `REMINDERS_QUEUE` message
  per due reminder; the queue consumer (`processReminderMessage`, called
  from `src/index.ts`'s `queue()` handler) re-checks the appointment is
  still `SCHEDULED` — so a cancellation between the sweep and the send is
  still honored — and sends. Because "due" is computed directly from
  `Appointment.scheduledAt`/`.status` on every sweep, there's nothing to
  schedule or cancel ahead of time: `scheduleForAppointment`/
  `cancelForAppointment` (still called by `AppointmentsService`/
  `PaymentsService`, unchanged from Phase 4) are now documented no-ops.
  Verified end-to-end by hand via `wrangler dev --test-scheduled`'s
  `/__scheduled` endpoint: a sweep found a due appointment, enqueued it,
  the local queue simulator delivered it to the consumer, the SMS was
  logged and a `Notification` row created; a second sweep immediately
  after correctly enqueued 0 (the dedup check against that `Notification`
  row held); cancelling the appointment and sweeping again also enqueued 0
  (excluded by the `status: SCHEDULED` filter).
- **`RemindersService.stats()`'s shape changed**: apps/api's version
  reports BullMQ job counts (`waiting`/`delayed`/`active`/`completed`/
  `failed`) — there's no equivalent job-state machine in the cron-sweep
  design above. `GET /admin/reminders/stats` now returns
  `{ sentLast24h, pendingInNext24h }` instead — a different shape, but
  answering the same operational question ("is the pipeline keeping up").
- **AI SOAP drafting**: same mock-only posture as every other AI provider
  in this Worker (intake summary, CPB verification) — no live OpenAI
  adapter exists on either backend, and `createAuthContext` logs apps/api's
  same "no live adapter" warning if `AI_MODE=live`. The mock produces the
  same `[THERAPIST TO CONFIRM ...]`-placeholder draft skeleton; it's an
  optional assist, never required for storage (the therapist always writes/
  reviews the real note via `POST /clinical-notes`).
- **ABAC is the same `ClinicalAccessService` logic everywhere**: a
  therapist may view a patient's clinical data only if an appointment
  exists between them; a patient may view only their own; admins may view
  any (for compliance — every access is still audited). This single
  service backs SOAP notes, treatment plans, and the health record, so the
  access rule can't drift between them, same as apps/api.
- **Payouts live inside `AnalyticsService`, not a standalone module** —
  this is apps/api's own structure, not a Worker-side simplification: there
  never was a separate payouts controller to port. `POST /admin/payouts/
  :therapistId/pay` is a mock M-Pesa B2C payout of a therapist's pending
  balance (gross session revenue minus the 25% platform commission, minus
  what's already been paid out); paying out a zero balance correctly
  `409`s. Verified by hand: paid out a therapist's full pending balance,
  confirmed the payout queue and `GET /therapist/earnings` both reflected
  it, confirmed paying again `409`s, and confirmed the payout shows up in
  `GET /admin/audit-log?action=payout`.
- **Rate limiting**: same story as every prior phase — none of these
  controllers carry an explicit `@Throttle(...)` in apps/api, so all 26 new
  routes use the global default (100/min), one binding per route.

**Known limitation, extended again**: every Phase 5 route that touches the
database (conversations, messages, mood, content, clinical notes,
treatment plans, health record, caseload, analytics/revenue/payouts,
audit log) was verified by hand via `wrangler dev` rather than by a Vitest
integration test, for the same `pg`-in-Miniflare reason as every prior
phase. The reminder sweep/consumer pipeline is the one exception worth
calling out: `test/reminders-service.spec.ts` *does* cover
`sweepDueReminders`'s window and dedup logic in Vitest, without a real
Postgres connection, by passing a minimal duck-typed fake in place of
`PrismaClient` (the function only ever calls `.appointment.findMany`/
`.notification.findMany` on it) — a pattern worth reusing for other
DB-touching pure logic if a future phase has more of it. See the Phase 5
PR description for the full manual test transcript.

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

3. **KV namespace** (access-token blocklist + OTP issuance throttle):

   ```bash
   npx wrangler kv namespace create suluhu-api-auth
   ```

   Copy the returned id into `wrangler.jsonc`'s `kv_namespaces[0].id`
   (replacing `REPLACE_WITH_KV_NAMESPACE_ID`).

4. **Rate limiting bindings** — nothing to create; the `namespace_id`s under
   `unsafe.bindings` in `wrangler.jsonc` are arbitrary small integers you pick
   yourself (Cloudflare's docs use this pattern), not provisioned resources.

5. **R2 bucket** (Phase 3, therapist documents — declared now so the binding
   exists from day one):

   ```bash
   npx wrangler r2 bucket create suluhu-documents
   ```

6. **Queue** (Phase 5, reminders):

   ```bash
   npx wrangler queues create suluhu-reminders
   ```

7. **Secrets** — every one of these via `wrangler secret put <NAME>` (run
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

8. **Custom domain.** First `wrangler deploy` with the `routes` entry in
   `wrangler.jsonc` (`api.suluhutherapy.com`) creates the DNS record and
   certificate automatically, same as `apps/web`'s `suluhutherapy.com` — see
   `apps/web/CLOUDFLARE.md` for the general pattern. Delete any existing
   A/CNAME for that hostname first if one exists.

## Bindings reference (`wrangler.jsonc`)

| Binding                             | Type       | Used by |
| ------------------------------------ | ---------- | ------- |
| `HYPERDRIVE`                         | Hyperdrive | Phase 1 (health, then everything DB-backed) |
| `AUTH_KV`                            | KV         | Phase 2 (access-token blocklist, OTP issuance throttle) |
| `DOCUMENTS`                          | R2 Bucket  | Phase 3 (therapist documents) |
| `REMINDERS_QUEUE`                    | Queue      | Phase 5 (reminder sweep → consumer, see "Reminders" above) |

Rate Limiting bindings — one **per route**, not per limit value (see
"Auth & users (Phase 2)" above for why):

| Limit    | Bindings |
| -------- | -------- |
| 10/min   | `RATE_LIMITER_AUTH_REGISTER`, `RATE_LIMITER_AUTH_LOGOUT`, `RATE_LIMITER_AUTH_PASSWORD_RESET`, `RATE_LIMITER_AUTH_PASSWORD_CHANGE`, `RATE_LIMITER_AUTH_TEST_OTP` |
| 5/min    | `RATE_LIMITER_AUTH_LOGIN`, `RATE_LIMITER_AUTH_GOOGLE`, `RATE_LIMITER_AUTH_GOOGLE_REGISTER`, `RATE_LIMITER_AUTH_MFA_VERIFY`, `RATE_LIMITER_AUTH_OTP_VERIFY` |
| 3/min    | `RATE_LIMITER_AUTH_OTP_REQUEST`, `RATE_LIMITER_AUTH_PASSWORD_FORGOT` |
| 100/min  | Every other `RATE_LIMITER_*` binding (72 in total) — one per route, across Phases 2–5. See `wrangler.jsonc` for the full list; too long to usefully enumerate here. |

`queue()` and `scheduled()` handlers in `src/index.ts` are fully wired as of
Phase 5 — `scheduled()` runs the reminder sweep every 5 minutes (the cron
trigger declared below) and `queue()` consumes `REMINDERS_QUEUE` to send
each due reminder, per-message acked or retried. Test locally with
`wrangler dev --test-scheduled`, which exposes a `GET /__scheduled` endpoint
that fires `scheduled()` on demand (the local queue simulator then delivers
any enqueued messages to `queue()` automatically).

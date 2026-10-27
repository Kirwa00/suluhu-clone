# @suluhu/api-worker

Cloudflare Workers port of the Suluhu Therapy Center API — same `/api/v1/...`
HTTP contract as `apps/api` (NestJS), running on Hono + Prisma (driver
adapters) + Cloudflare bindings instead of Express + raw Postgres/Redis
connections. See the root `CLAUDE.md` / `Suluhu_Therapy_Center_SDLC_Documentation.md`
for product context.

**Status: Phases 1–6 implemented and tested locally; not yet deployed.**
This Worker is the production API (the NestJS/VPS stack never went live and is
retired — see `deploy/README.md`). It exposes the full `/api/v1/...` surface:
health, auth/users, therapist onboarding + discovery, admin approval +
clinical alerts, intake & triage, booking + appointments, video sessions,
M-Pesa payments, secure patient-therapist messaging, the mood journal,
psychoeducation content, SOAP clinical notes + treatment plans + the
aggregated patient health record (all PHI-encrypted and ABAC-gated), and admin
analytics/revenue/payouts + the audit-log viewer. Launch steps (fresh Neon,
R2, no data migration) are in `deploy/CUTOVER.md`.

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
   | `JWT_ACCESS_SECRET`      | Fresh: `openssl rand -base64 48`                     |
   | `JWT_REFRESH_SECRET`     | Fresh: `openssl rand -base64 48`                     |
   | `PHI_ENCRYPTION_KEY`     | Fresh: `openssl rand -base64 32` — store in a password manager; not rotatable once data exists |
   | `PAYHERO_API_USERNAME`   | Only once `MPESA_MODE=live`                          |
   | `PAYHERO_API_PASSWORD`   | Only once `MPESA_MODE=live`                          |
   | `PAYHERO_CHANNEL_ID`     | Only once `MPESA_MODE=live`                          |
   | `MPESA_CALLBACK_URL`     | Only once `MPESA_MODE=live`                          |
   | `AT_USERNAME`            | Only once `SMS_MODE=live`                            |
   | `AT_API_KEY`             | Only once `SMS_MODE=live`                            |
   | `GOOGLE_CLIENT_ID`       | Only if Sign in with Google is enabled               |

   Flip the `*_MODE` vars themselves in `wrangler.jsonc`'s `vars` block (they're
   non-secret) once you're ready to go live with a given provider.

   `RESEND_API_KEY` (once `EMAIL_MODE=live`) and `DAILY_API_KEY`/`DAILY_DOMAIN`
   (once `VIDEO_MODE=live`) are the exception: don't set these by hand via
   `wrangler secret put` or the Cloudflare dashboard. Add them as **GitHub repo
   secrets** instead (Settings → Secrets and variables → Actions) — the deploy
   workflow (`.github/workflows/deploy-cloudflare-api.yml`) copies them onto the
   Worker on every deploy. Setting `DAILY_API_KEY`/`DAILY_DOMAIN` only via the
   dashboard turned out not to survive the next deploy in practice (the Worker
   started 500ing on every request, `validateEnv()` failing its
   `VIDEO_MODE=live requires: ...` check) — the repo-secret-backed deploy step
   doesn't have that problem, since it re-applies them every time.

8. **Custom domain.** First `wrangler deploy` with the `routes` entry in
   `wrangler.jsonc` (`api.suluhutherapy.com` — the `suluhutherapy.com` zone is on Cloudflare; `.co.ke` isn't) creates the DNS record and
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

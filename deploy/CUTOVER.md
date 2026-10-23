# Phase 6: cutting the API over from the VPS to Cloudflare Workers

This is the last step of the `apps/api` → `apps/api-worker` port (see
`apps/api-worker/README.md` for what's already been ported in Phases 1–5).
Today, production is:

```
suluhutherapy.co.ke, suluhutherapy.com  →  Cloudflare Worker `suluhu-web`  (apps/web)
api.suluhutherapy.co.ke                 →  HostAfrica VPS, Caddy → api:4000 (apps/api, NestJS)
                                            Postgres + Redis + local disk documents, all on the VPS
```

After this runbook:

```
suluhutherapy.co.ke, suluhutherapy.com  →  Cloudflare Worker `suluhu-web`   (unchanged)
api.suluhutherapy.co.ke                 →  Cloudflare Worker `suluhu-api`   (apps/api-worker, Hono)
                                            Neon Postgres (via Hyperdrive) + R2 documents
```

**The API's hostname does not change** — `api.suluhutherapy.co.ke` stays
`api.suluhutherapy.co.ke`, only what answers on it changes (VPS Caddy →
Cloudflare Worker custom domain). That is deliberate: every external
integration that calls back into the API by that hostname — PayHero's
M-Pesa callback, Daily's webhook (if configured), the mobile/web client's
`NEXT_PUBLIC_API_URL` once rebuilt — keeps working with **no config change
on their end**. The only things that need updating are described in step 7
below, and most of this runbook's risk is in the data migration, not DNS.

This is irreversible-ish in the sense that patient data (PHI) is involved —
read the whole runbook before starting, and do not run it without a recent,
verified backup (step 0) and the rollback plan (bottom) in hand.

## 0. Before the maintenance window

Do all of this with the VPS stack still live and untouched — none of it
requires downtime.

- [ ] **Fresh backup.** Run `deploy/backup-db.sh` by hand (don't wait for the
      cron job) and copy the resulting `.sql.gz` off the VPS (e.g. download it
      to your own machine). This is the last-resort rollback artifact if
      anything in this runbook goes wrong *after* the VPS database is touched
      — `migrate-db-to-neon.sh` itself never writes to the VPS, but have this
      anyway.
- [ ] **Neon project.** Create it (region closest to Kenya — Frankfurt,
      `eu-central-1`), per `apps/api-worker/README.md`'s "One-time setup" §1.
      Grab both the pooled and direct connection strings.
- [ ] **Hyperdrive, KV namespace, R2 bucket, Queue.** Create all four per the
      same README section (§2–6), over the *empty* Neon database — don't wait
      until data is migrated, these are just infra, not data.
- [ ] **Secrets.** `wrangler secret put` the `JWT_ACCESS_SECRET`,
      `JWT_REFRESH_SECRET` and `PHI_ENCRYPTION_KEY` — **copy the exact values
      apps/api already uses in `.env.production` on the VPS**, not new ones.
      Getting `PHI_ENCRYPTION_KEY` wrong makes every existing clinical note
      permanently undecryptable; there is no recovery from a wrong value
      here, only from not having set it yet.
- [ ] **Deploy `suluhu-api` once, against the empty Neon DB, before the
      window.** `cd apps/api-worker && npx wrangler deploy`. This exercises
      the build/deploy path and gets the Worker, its custom domain
      certificate, etc. provisioned ahead of time — it won't receive real
      traffic yet because `api.suluhutherapy.co.ke` still points at the VPS.
      Smoke-test it at its `*.workers.dev` URL (health check, register a
      throwaway test account, nothing real).
- [ ] **Pick a low-traffic window** and tell whoever needs to know there will
      be a short booking/login freeze (expect single-digit minutes for the
      data migration itself; plan for 30 to account for verification steps).

## 1. Freeze writes on the VPS

```bash
ssh root@102.68.87.163   # see CLAUDE.md if this still doesn't connect
cd /opt/suluhu
docker compose -f docker-compose.prod.yml --env-file .env.production stop api
```

Stopping the `api` container (not `postgres`) is enough — it serves every
write path (bookings, payments, messages, documents), and stopping it turns
any in-flight request into a clean connection-refused rather than a
half-written row. Leave `postgres` running; the migration script reads from
it live.

## 2. Migrate the database

Still on the VPS, from `/opt/suluhu`:

```bash
NEON_DIRECT_URL='postgresql://...neon direct url.../suluhu?sslmode=require' \
  ./deploy/migrate-db-to-neon.sh
```

Read the script (`deploy/migrate-db-to-neon.sh`) before running it — it
`pg_dump`s the live container and restores into Neon with `--clean`, then
compares per-table row counts. Investigate any mismatch it reports before
continuing (see the script's own caveat about stats staleness vs. real data
loss — `analyze;` on both sides if unsure).

## 3. Migrate therapist documents

Copy (or already have access to) the `suluhu_documents` volume's contents
from the VPS, then from your own machine (or anywhere with `wrangler` and
Cloudflare credentials):

```bash
docker cp suluhu-api-1:/data/therapist-documents ./therapist-documents-export
# (container name may differ — `docker compose ps` to confirm)

cd apps/api-worker
SOURCE_DIR=../../therapist-documents-export R2_BUCKET=suluhu-documents \
  ../../deploy/migrate-documents-to-r2.sh
```

This is a pure key-for-key copy (see the script header for why no database
rows need to change). Re-run it if anything fails partway — it's idempotent.

## 4. Point `suluhu-api` at the migrated data and redeploy

If the Hyperdrive config was created against the (now populated) Neon
database already, nothing changes here — redeploy anyway to be sure you're
running the latest build:

```bash
cd apps/api-worker
npx wrangler deploy
```

## 5. Smoke-test the Worker against real (migrated) data

At the Worker's `*.workers.dev` URL (not yet the live hostname):

- [ ] `GET /api/v1/health` → `200`, `database.status: "up"`
- [ ] Log in as an existing (non-test) therapist or admin account you know
      the credentials for, complete MFA → confirms JWT secrets and the OTP
      flow are correct against real user rows.
- [ ] Fetch a therapist's document list and download one → confirms the R2
      migration's keys resolve.
- [ ] Open an existing patient's health record as that patient's therapist
      → confirms `PHI_ENCRYPTION_KEY` decrypts real, previously-written data
      (this is the one check nothing earlier in the runbook can substitute
      for).
- [ ] `GET /api/v1/admin/metrics` as an admin → sanity-check the numbers
      against what you'd expect from the VPS before the freeze.

Do **not** perform a real booking, payment, or message send in this step —
anything that writes should use a disposable test account, never a real
patient's.

If anything here fails, stop — do not proceed to step 6. The VPS is still
serving traffic (frozen for writes only via the stopped `api` container; see
the rollback section to bring it back if you need more time to investigate).

## 6. Cut traffic over

In the Cloudflare dashboard (or `wrangler deploy` already did this): the
Worker's `routes` entry in `wrangler.jsonc` claims the custom domain
`api.suluhutherapy.co.ke` on deploy. Confirm in **Workers & Pages → suluhu-api
→ Settings → Domains & Routes** that it's attached and **remove any
conflicting DNS record** Cloudflare's dashboard flags for that hostname (the
A/AAAA records that used to point `api.suluhutherapy.co.ke` at the VPS) —
Cloudflare refuses to attach a custom domain over an existing record it
doesn't manage as part of the Worker route.

Traffic to `api.suluhutherapy.co.ke` now reaches the Worker. Re-run the step
5 checklist against the real hostname this time.

## 7. Things that need updating because the *backend* changed, even though the hostname didn't

- **Nothing on `apps/web`** — it already calls `https://api.suluhutherapy.co.ke`
  (see `apps/web/wrangler.jsonc`'s `NEXT_PUBLIC_API_URL`), so no rebuild is
  needed for this cutover specifically.
- **PayHero (M-Pesa) callback, Daily webhook, Resend/Africa's Talking
  configs** — unaffected, same hostname. Only re-point these if you're
  *also* changing `MPESA_MODE`/`VIDEO_MODE`/etc. to `live` on the Worker for
  the first time (a separate decision from this cutover — see
  `apps/api-worker/README.md`'s secrets table).
- **Google Sign-In** — unaffected. The OAuth client's *Authorized JavaScript
  origins* are the **web** app's origins (`suluhutherapy.co.ke`, `.com`),
  which this runbook never touches; Google ID-token verification checks the
  token's `aud` claim against `GOOGLE_CLIENT_ID`, not the API's hostname.
  Nothing to change here — this was flagged as a possible action item
  up front, but turned out not to apply once the hostname-preserving design
  above was settled on.
- **`CORS_ORIGINS` on the Worker** — already set to the production web
  origins in `wrangler.jsonc`; double check it matches whatever
  `apps/web`'s actual live origins are before step 6 (it's a non-secret
  `vars` entry, redeploy to change it).

## 8. Decommission the VPS API (only once confident — days, not minutes)

Once the Worker has run live for a few days without issues:

- Stop and remove the VPS's `api`, `postgres`, `redis` containers and the
  `suluhu_documents`/`suluhu_postgres_data` volumes (keep a final backup
  first, obviously).
- Update `deploy/README.md` and `docker-compose.prod.yml` to drop the
  services that no longer run anything, or repurpose the box.
- Cancel the `/etc/cron.daily/suluhu-backup` cron job (or point
  `backup-db.sh` at Neon instead — Neon also has its own built-in backups,
  which may make this redundant).

## Rollback

**Any point up through step 5:** the VPS has not been touched beyond
`docker compose stop api` in step 1. Restart it:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production start api
```

Traffic was never re-pointed, so this fully restores service with zero data
loss (the Neon migration only ever *read* from the VPS database).

**After step 6 (traffic already cut over):** re-point
`api.suluhutherapy.co.ke`'s DNS/custom-domain back at the VPS (remove the
Worker's custom domain route, restore the A/AAAA record Caddy expects) and
`docker compose start api` on the VPS. Any writes the Worker accepted
against Neon between step 6 and the rollback will **not** be on the VPS's
Postgres — decide whether to replay them manually (likely very few, given
this is done in a low-traffic window) or accept the loss before rolling
back. This is the one scenario this runbook can't make fully reversible;
minimizing time between steps 6 and "confident it's fine" is the mitigation.

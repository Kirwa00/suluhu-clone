# Fresh launch runbook: apps/api-worker on Cloudflare

Production is `apps/api-worker` (Hono on Cloudflare Workers) at
`https://api.suluhutherapy.co.ke`, with `apps/web` on the `suluhu-web` Worker.
There is no VPS and no data migration: the old VPS stack never went live, so
the database and document bucket start empty.

Run everything from `apps/api-worker/` with Cloudflare credentials
(`npx wrangler login`, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`).

## 0. Prerequisites

- `suluhutherapy.co.ke` must be a zone in the same Cloudflare account — a
  Worker custom domain can only attach to a hostname in a zone Cloudflare
  serves. Delete any existing A/CNAME for `api.suluhutherapy.co.ke` first.
- Pre-deploy checks, all green:

  ```bash
  npm run typecheck && npm run lint && npm run test && npx wrangler deploy --dry-run
  ```

## 1. Neon Postgres

1. Create a Neon project in `aws-eu-central-1` (Frankfurt). Keep both the
   **pooled** connection string (Hyperdrive) and the **direct** one
   (migrations).
2. Apply the schema — do **not** run `db:seed` (demo accounts):

   ```bash
   DATABASE_URL=<direct url> DIRECT_URL=<direct url> npm run -w @suluhu/api db:migrate
   ```

## 2. Cloudflare resources

```bash
npx wrangler r2 bucket create suluhu-documents
npx wrangler hyperdrive create suluhu-api-db --connection-string="<pooled url>"
npx wrangler kv namespace create suluhu-api-auth
npx wrangler queues create suluhu-reminders
```

Put the Hyperdrive and KV ids into `wrangler.jsonc` (replacing the
`REPLACE_WITH_...` placeholders) and commit that change — the ids aren't
secret. Confirm `routes` still says `api.suluhutherapy.co.ke`.

## 3. Secrets

Generate fresh values — never reuse anything from `.env.production.example`:

```bash
openssl rand -base64 48 | npx wrangler secret put JWT_ACCESS_SECRET
openssl rand -base64 48 | npx wrangler secret put JWT_REFRESH_SECRET
openssl rand -base64 32   # PHI_ENCRYPTION_KEY: save to a password manager FIRST,
npx wrangler secret put PHI_ENCRYPTION_KEY   # then paste it here
```

`PHI_ENCRYPTION_KEY` can't be rotated in place once clinical data exists —
losing it means losing every encrypted record. Leave every `*_MODE` var on
`mock`; add a provider's secrets only when its mode flips to `live`
(see `apps/api-worker/README.md`).

## 4. Deploy and smoke-test

```bash
npx wrangler deploy
curl -s https://api.suluhutherapy.co.ke/api/v1/health   # database.status: "up"
```

Then, against the live API: register a throwaway patient, complete email MFA
(with `EMAIL_MODE=mock` the code is in `npx wrangler tail`), log in, refresh
the token, and fetch `/api/v1/users/me`. Delete the throwaway user afterwards.

After this, `.github/workflows/deploy-cloudflare-api.yml` redeploys on every
green CI run on `main` (needs the `CLOUDFLARE_API_TOKEN` token to also have
Hyperdrive, KV, R2 and Queues edit, plus DNS edit on `suluhutherapy.co.ke`).

## 5. Web

`apps/web/.env.production` already sets
`NEXT_PUBLIC_API_URL=https://api.suluhutherapy.co.ke`. It's baked in at build
time, so redeploy `apps/web` (`cd apps/web && npm run cf:deploy`, or push to
`main`) and check registration/login on the live site hits the Worker API
(Network tab or `wrangler tail`).

## 6. First admin

There's no seed in production. Register the admin through the site, then
promote that one row directly in Neon's SQL editor:

```sql
UPDATE users SET role = 'ADMIN' WHERE email = '<admin email>';
```

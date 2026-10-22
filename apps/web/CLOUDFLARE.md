# Deploying apps/web to Cloudflare Workers (suluhutherapy.com)

**Target:** the `suluhu-web` Worker serves the web app on
`suluhutherapy.com` and `www.suluhutherapy.com` (that zone's DNS is on
Cloudflare). The API stays on the VPS at `api.suluhutherapy.co.ke`.

### One-time setup checklist

1. **Cloudflare DNS (suluhutherapy.com zone):** delete the existing `A`/`CNAME`
   records for `suluhutherapy.com` and `www` (they point at the VPS). The
   Worker's custom domains (`routes` in `wrangler.jsonc`) create their own
   records + certificates on the first deploy and fail if a record exists.
2. **API CORS (VPS `/opt/suluhu/.env.production`):** add the new origins and
   restart the API:
   `CORS_ORIGINS=https://suluhutherapy.co.ke,https://suluhutherapy.com,https://www.suluhutherapy.com`
3. **Caddy (VPS):** set `WEB_DOMAIN_REDIRECT` so it no longer lists
   `suluhutherapy.com` (or delete that Caddyfile block) — the Worker owns the
   hostname now and Caddy's Let's Encrypt renewals for it would fail.
4. **Google sign-in:** add `https://suluhutherapy.com` and
   `https://www.suluhutherapy.com` to the OAuth client's *Authorized
   JavaScript origins* in Google Cloud Console, and provide
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID` at build time (env var locally, repo
   variable in GitHub Actions). Without it the Google button is hidden.
5. **Deploy credentials:** a Cloudflare API token with *Workers Scripts:Edit*,
   *Workers Routes:Edit* and *DNS:Edit* (zone suluhutherapy.com), plus the
   account ID. Locally: `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` env
   vars (or `npx wrangler login`). In GitHub: repo secrets of the same names,
   used by `.github/workflows/deploy-cloudflare.yml` (runs after CI on main,
   or manually via *Run workflow*).

Build-time public values (`NEXT_PUBLIC_API_URL`) live in
`apps/web/.env.production`; real env vars override them. `cf:build` builds the
`@suluhu/shared` / `@suluhu/ui` workspace packages first, so a fresh
`npm ci && npm run cf:deploy` (from `apps/web`) works end to end.

This scaffolds a **hybrid** setup: the Next.js frontend (`apps/web`) can be
deployed to Cloudflare's edge via [OpenNext for Cloudflare](https://opennext.js.org/cloudflare)
(`@opennextjs/cloudflare`), while the NestJS API, Postgres, and Redis stay
exactly where they are today — the HostAfrica VPS (`/opt/suluhu`, Docker
Compose). The frontend keeps talking to `api.suluhutherapy.co.ke` over HTTPS,
same as now.

## What's scaffolded here

- `open-next.config.ts` — OpenNext build config. No incremental cache override
  is wired up (the app has no `revalidate`/ISR usage today, so there's nothing
  to cache).
- `wrangler.jsonc` — Worker config: static assets binding, `nodejs_compat` +
  `global_fetch_strictly_public` compatibility flags, and `NEXT_PUBLIC_API_URL`
  set to the production API.
- `package.json` scripts:
  - `npm run cf:build` — runs `opennextjs-cloudflare build` (builds Next.js,
    then adapts the output for Workers into `.open-next/`).
  - `npm run cf:preview` — build, then run the Worker locally via Wrangler
    (closer to production than `next dev`).
  - `npm run cf:deploy` — build, then `wrangler deploy`.
  - `npm run cf:typegen` — generate `worker-configuration.d.ts` typings for
    the bindings in `wrangler.jsonc`.
- `.gitignore` entries for `.open-next/`, `.wrangler/`, `.dev.vars`.

**Verified in this session:** `npm run cf:build` (`opennextjs-cloudflare
build`) completes successfully against the current `apps/web` source —
`next build` compiles all 32 routes, OpenNext bundles the Worker, and
`npx wrangler deploy --dry-run` confirms `wrangler.jsonc` parses and the
asset/env bindings resolve correctly. No credentials were available in this
session, so an actual `wrangler deploy` was not attempted — that's the manual
step below.

## What's deliberately NOT touched

- `apps/api` (NestJS), Prisma/Postgres, Redis, and `docker-compose.prod.yml`
  are untouched. Workers' runtime can't run a long-lived Express/Nest server
  or hold a raw TCP connection to self-hosted Postgres without an extra
  product (Cloudflare Hyperdrive) and more migration work — that's a separate
  effort, not part of this change.
- The VPS deploy stack in `deploy/` is unaffected. This is additive: the web
  app can now deploy to **either** Docker Compose (as today) **or**
  Cloudflare Workers, independently.

## A dependency version constraint worth knowing

`@opennextjs/cloudflare` dropped Next.js 14 support as of its `1.16.0`
release — from that version on it requires Next 15.x/16.x. This repo is on
Next `14.2.35`, so the installed version is pinned to **`1.15.1`** (the last
release whose peer range, `^14.2.35 || ...`, matches it exactly) with
`wrangler ^4.59.2` (its required peer). If this repo upgrades to Next 15+
later, `@opennextjs/cloudflare` can be bumped to latest at the same time.

## Manual steps to actually deploy (do this from your own machine)

1. **Cloudflare account + API token.** Make sure you have a Cloudflare
   account with Workers enabled. Log in from the repo root:

   ```bash
   cd apps/web
   npx wrangler login
   ```

   (Opens a browser to authorize Wrangler. For CI, use an API token instead —
   `CLOUDFLARE_API_TOKEN` env var with `Workers Scripts:Edit` permission —
   and skip the interactive login.)

2. **Review `wrangler.jsonc`.** The Worker is named `suluhu-web`; rename it if
   you want a different name/subdomain. `NEXT_PUBLIC_API_URL` is set to
   `https://api.suluhutherapy.co.ke` — change it if you want to point a
   preview deploy at a different API.

3. **Build and deploy:**

   ```bash
   cd apps/web
   npm run cf:deploy
   ```

   This runs `opennextjs-cloudflare build` then `wrangler deploy`. First
   deploy will give you a `*.workers.dev` URL; add a custom domain (e.g.
   `suluhutherapy.co.ke`) via the Cloudflare dashboard → Workers & Pages →
   your worker → Settings → Domains & Routes. `wrangler.jsonc` already binds
   `suluhutherapy.com` and `www.suluhutherapy.com` as custom domains, so the
   first deploy attaches them (after step 1 of the checklist above).

4. **Preview locally first (optional but recommended):**

   ```bash
   npm run cf:preview
   ```

   Runs the built Worker under real `workerd`, closer to production than
   `next dev`.

## Caveats / things that don't translate cleanly to Workers

Nothing in the current `apps/web` source hit a hard incompatibility — no
Node-only APIs (`fs`, `node:crypto`, etc.), no Next.js middleware, no API
routes, no server actions, and no ISR/ `revalidate` usage were found. A few
things worth knowing if the app grows:

- **Image optimization (`next/image`):** works today, but *without* a
  dedicated image-resizing binding — `wrangler.jsonc` doesn't enable one, so
  optimization requests fall back to serving the original image unmodified
  (OpenNext does this gracefully; it won't error). To get real resizing on
  the edge, add an `images` binding to `wrangler.jsonc` (see the commented-out
  block at the bottom of that file) — this uses Cloudflare Images and may
  have its own cost/plan implications.
- **ISR / `revalidate` / full route cache:** if a page starts using
  `export const revalidate = ...` or on-demand revalidation, the default
  (in-memory, per-isolate) cache is unreliable across Worker instances. At
  that point, wire up the R2-backed incremental cache — uncomment the
  `r2_buckets` block in `wrangler.jsonc`, create the bucket
  (`wrangler r2 bucket create suluhu-web-cache`), and set
  `incrementalCache: r2IncrementalCache` in `open-next.config.ts` (the import
  is already referenced in a comment there).
- **`NEXT_PUBLIC_*` env vars are still inlined at build time.** Changing
  `NEXT_PUBLIC_API_URL` means rebuilding (`npm run cf:build`) and redeploying,
  not just editing `wrangler.jsonc` — the `vars` entry there only affects
  values read from `process.env` at *request* time on the server side (none
  currently), not the client bundle.
- **Cold starts / global state:** none of the current code relies on
  module-level mutable state surviving between requests (no in-memory
  sessions, caches, etc. in `apps/web`), so there's nothing here that would
  misbehave under Workers' per-request isolate model.

## Why OpenNext for Cloudflare, not `@cloudflare/next-on-pages`

`@cloudflare/next-on-pages` (Cloudflare Pages' Next.js adapter) is
effectively in maintenance mode — Cloudflare's own docs now point new
projects at OpenNext + Workers instead, which has broader App Router/Next.js
feature support (middleware, ISR via R2, image optimization hooks, etc.) and
is the actively developed path.

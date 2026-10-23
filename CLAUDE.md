# Suluhu Therapy Center — project notes for Claude

NestJS API + Next.js web, Turborepo monorepo (npm workspaces). Production is
Cloudflare Workers: `apps/api-worker` (API, Neon + R2) and `apps/web` — see
`deploy/CUTOVER.md`.

## Legacy VPS (retired, never went live)

- Host: HostAfrica VPS, IP `102.68.87.163`, hostname `suluhu-prod.suluhutherapy.co.ke`
- Code lives at `/opt/suluhu` on the server, deployed via Docker Compose
  (`docker-compose.prod.yml`)
- Domains: `suluhutherapy.co.ke` (canonical), `suluhutherapy.com` (redirects to it),
  `api.suluhutherapy.co.ke` — all via Cloudflare DNS, proxied, SSL mode "Full (strict)"
- A dedicated SSH deploy keypair exists locally as `~/suluhu_deploy_key` /
  `~/suluhu_deploy_key.pub` (generated for both manual access and the GitHub Actions
  deploy workflow's `VPS_SSH_KEY` secret)
- The public half of that key has already been added via the HostAfrica panel's
  **Management → Overview → Machine Config → SSH Public Key** field

## Known issue: SSH (port 22) unreachable from outside

As of the last session working on this, `ssh -i ~/suluhu_deploy_key root@102.68.87.163`
times out from every tested network/tool (PowerShell, Git Bash, and confirmed
independently via canyouseeme.org that port 22 reads as closed externally).

Tried without success:
- A firewall rule in the HostAfrica panel's "Firewall" page (0.0.0.0/0, TCP,
  destination port 22, ACCEPT, enabled, position 1)
- Adding the SSH public key via Machine Config (above)
- Rebooting the server

Not yet confirmed:
- Whether a *second*, separate firewall/security-group layer exists in the
  HostAfrica panel, distinct from the "Firewall" page already tried
- Diagnosing from inside the server via the VNC/web console (blocked — the
  root password is unknown and no self-service reset option was found in the
  panel; a GRUB single-user-mode boot was suggested as a workaround but
  never confirmed to work)
- What HostAfrica support says when asked directly whether port 22 is
  blocked at their infrastructure level for this server

If you have real network access (i.e. you're not running in a sandboxed/
restricted environment), start by actually attempting the SSH connection and
report what specifically happens — a prior cloud session working on this
could not make outbound SSH connections at all, so this was never directly
tested end-to-end by that Claude session, only relayed through the user's
own terminal.

## Auth: email MFA

Every role (including patients, as of a recent change) requires an email OTP
on login — see `apps/api/src/modules/auth/auth.service.ts` (`startSession`)
and `packages/shared/src/enums.ts` (`MFA_REQUIRED_ROLES`). Uses whichever
`EMAIL_MODE` provider is configured (mock logs to console; live uses SMTP,
currently set up with Resend).

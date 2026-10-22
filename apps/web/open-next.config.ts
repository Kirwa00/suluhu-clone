import { defineCloudflareConfig } from '@opennextjs/cloudflare/config';

// Minimal config: no R2 incremental cache wired up (the app has no ISR/revalidate
// usage today). Add `incrementalCache: r2IncrementalCache` from
// "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache"
// later if a route starts using `revalidate` — see apps/web/CLOUDFLARE.md.
export default defineCloudflareConfig();

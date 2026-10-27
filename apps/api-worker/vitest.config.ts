import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Tests never send real email or create real video rooms; production
      // sets EMAIL_MODE/VIDEO_MODE=live in wrangler.jsonc.
      miniflare: { bindings: { EMAIL_MODE: 'mock', VIDEO_MODE: 'mock' } },
    }),
  ],
  test: {
    server: { deps: { inline: ['pg', '@prisma/adapter-pg'] } },
  },
});

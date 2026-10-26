import { describe, expect, it } from 'vitest';
import { PLATFORM_COMMISSION_MAX, PLATFORM_COMMISSION_MIN } from '../constants';
import { updatePlatformCommissionSchema } from './platform-settings';

describe('updatePlatformCommissionSchema', () => {
  it('accepts the commission-band bounds and coerces numeric strings', () => {
    for (const platformCommissionRate of [PLATFORM_COMMISSION_MIN, PLATFORM_COMMISSION_MAX]) {
      const parsed = updatePlatformCommissionSchema.parse({
        platformCommissionRate: String(platformCommissionRate),
      });
      expect(parsed.platformCommissionRate).toBe(platformCommissionRate);
    }
  });

  it('rejects a rate outside the band', () => {
    for (const platformCommissionRate of [
      PLATFORM_COMMISSION_MIN - 0.01,
      PLATFORM_COMMISSION_MAX + 0.01,
    ]) {
      expect(updatePlatformCommissionSchema.safeParse({ platformCommissionRate }).success).toBe(
        false,
      );
    }
  });

  it('requires platformCommissionRate', () => {
    expect(updatePlatformCommissionSchema.safeParse({}).success).toBe(false);
  });
});

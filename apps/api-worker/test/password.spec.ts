import { describe, expect, it } from 'vitest';
import { PasswordService } from '../src/lib/password';

/**
 * Hash produced by apps/api's actual (native `bcrypt`) PasswordService:
 * `bcrypt.hashSync('Str0ngPassw0rd!', 12)`. If `bcryptjs` (pure JS, used
 * here since Workers can't load the native binding) verifies it, existing
 * user passwords keep working unchanged after cutover.
 */
const OLD_SERVICE_HASH = '$2b$12$be8Hqp15oL0k3a81iR0fGex97EG.Zeb/HOOMVORHDEI8bzLtVi3pa';
const PASSWORD = 'Str0ngPassw0rd!';

describe('PasswordService', () => {
  it('verifies a hash produced by apps/api (native bcrypt) — same $2b$ format', async () => {
    const service = new PasswordService(12);
    expect(await service.compare(PASSWORD, OLD_SERVICE_HASH)).toBe(true);
  });

  it('rejects the wrong password against that same hash', async () => {
    const service = new PasswordService(12);
    expect(await service.compare('wrong-password', OLD_SERVICE_HASH)).toBe(false);
  });

  it('round-trips its own hash at the configured cost factor', async () => {
    const service = new PasswordService(10);
    const hash = await service.hash(PASSWORD);
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    expect(await service.compare(PASSWORD, hash)).toBe(true);
  });
});

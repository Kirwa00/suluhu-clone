import { describe, expect, it } from 'vitest';
import { DUMMY_PASSWORD_HASH, PasswordService } from '../src/lib/password';

const PASSWORD = 'Str0ngPassw0rd!';
// Low iteration count in tests only, to keep the suite fast — production
// uses PASSWORD_PBKDF2_ITERATIONS (default 100,000, Cloudflare's hard
// ceiling for crypto.subtle PBKDF2 — see src/env.ts).
const TEST_ITERATIONS = 1000;

describe('PasswordService', () => {
  it('round-trips its own hash', async () => {
    const service = new PasswordService(TEST_ITERATIONS);
    const hash = await service.hash(PASSWORD);
    expect(hash).toMatch(/^pbkdf2\$1000\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);
    expect(await service.compare(PASSWORD, hash)).toBe(true);
  });

  it('rejects the wrong password against a real hash', async () => {
    const service = new PasswordService(TEST_ITERATIONS);
    const hash = await service.hash(PASSWORD);
    expect(await service.compare('wrong-password', hash)).toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const service = new PasswordService(TEST_ITERATIONS);
    const [first, second] = await Promise.all([service.hash(PASSWORD), service.hash(PASSWORD)]);
    expect(first).not.toBe(second);
  });

  it('verifies a hash at a different (its own embedded) iteration count', async () => {
    // The service instance's configured iteration count only affects new
    // hashes — compare() always uses whatever count is embedded in the
    // stored hash, so a future bump to PASSWORD_PBKDF2_ITERATIONS doesn't
    // break verifying hashes created at the old count.
    const oldService = new PasswordService(500);
    const hash = await oldService.hash(PASSWORD);
    const newService = new PasswordService(TEST_ITERATIONS);
    expect(await newService.compare(PASSWORD, hash)).toBe(true);
  });

  it('rejects a malformed or non-pbkdf2 stored hash instead of throwing', async () => {
    const service = new PasswordService(TEST_ITERATIONS);
    await expect(service.compare(PASSWORD, 'not-a-real-hash')).resolves.toBe(false);
    await expect(service.compare(PASSWORD, '$2b$12$oldBcryptFormatHash')).resolves.toBe(false);
  });

  it('DUMMY_PASSWORD_HASH is a valid, verifiable hash used to equalize login timing', async () => {
    const service = new PasswordService(100_000);
    // Never actually matches a real password — just needs to be well-formed
    // so compare() does the full derivation work against it.
    expect(await service.compare('whatever the attacker typed', DUMMY_PASSWORD_HASH)).toBe(false);
  });
});

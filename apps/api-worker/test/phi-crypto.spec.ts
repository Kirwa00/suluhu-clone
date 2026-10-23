import { describe, expect, it } from 'vitest';
import { PhiCryptoService } from '../src/lib/phi-crypto';
import { base64ToBytes } from '../src/lib/crypto';

// Same deterministic 32-byte test key as
// apps/api/src/common/crypto/phi-crypto.service.spec.ts (`Buffer.alloc(32, 7)`).
const KEY_BASE64 = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';

/**
 * Ciphertext produced by apps/api's actual (Node `createCipheriv`)
 * PhiCryptoService, with the key above and plaintext "1995-04-12" — captured
 * by running that exact code once. If this Worker's WebCrypto port can
 * decrypt it, the two implementations are byte-compatible: same algorithm
 * (AES-256-GCM), same IV length, same tag length, same `v1.<iv>.<tag>.<data>`
 * serialization.
 */
const OLD_SERVICE_CIPHERTEXT = 'v1.eEt8VHyF6f5jD/nn.66WKr3HsH3oboYOHetKSVQ==.NA+W7bQWUPOlUQ==';
const OLD_SERVICE_PLAINTEXT = '1995-04-12';

function makeService(): PhiCryptoService {
  return new PhiCryptoService(base64ToBytes(KEY_BASE64));
}

describe('PhiCryptoService', () => {
  it('decrypts a value produced by apps/api (node:crypto) — byte-compatible format', async () => {
    const service = makeService();
    expect(await service.decrypt(OLD_SERVICE_CIPHERTEXT)).toBe(OLD_SERVICE_PLAINTEXT);
  });

  it('round-trips plaintext through AES-256-GCM', async () => {
    const service = makeService();
    const plaintext = '1995-04-12'; // e.g. a date of birth (PHI)
    const ciphertext = await service.encrypt(plaintext);
    expect(ciphertext).toMatch(/^v1\./);
    expect(ciphertext).not.toContain(plaintext);
    expect(await service.decrypt(ciphertext)).toBe(plaintext);
  });

  it('produces distinct ciphertext for identical plaintext (random IV)', async () => {
    const service = makeService();
    const a = await service.encrypt('same');
    const b = await service.encrypt('same');
    expect(a).not.toBe(b);
    expect(await service.decrypt(a)).toBe('same');
    expect(await service.decrypt(b)).toBe('same');
  });

  it('rejects tampered ciphertext', async () => {
    const service = makeService();
    const ciphertext = await service.encrypt('secret');
    const parts = ciphertext.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${btoa('evil')}`;
    await expect(service.decrypt(tampered)).rejects.toThrow();
  });

  it('computes a stable, case-insensitive blind index', async () => {
    const service = makeService();
    expect(await service.blindIndex(' Test@Example.com ')).toBe(
      await service.blindIndex('test@example.com'),
    );
  });

  it('compares strings in constant time via safeEquals', () => {
    const service = makeService();
    expect(service.safeEquals('abc', 'abc')).toBe(true);
    expect(service.safeEquals('abc', 'abd')).toBe(false);
    expect(service.safeEquals('abc', 'ab')).toBe(false);
  });
});

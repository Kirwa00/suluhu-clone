import { base64ToBytes, bytesToBase64, constantTimeEqual, sha256Hex } from './crypto';

/**
 * Application-layer encryption for PHI fields — WebCrypto port of
 * apps/api/src/common/crypto/phi-crypto.service.ts, byte-compatible with it.
 *
 * Same format: `v1.<iv>.<authTag>.<data>` (all base64), AES-256-GCM, 12-byte
 * IV, 16-byte (128-bit) auth tag. Node's `createCipheriv` returns ciphertext
 * and tag separately; WebCrypto's `encrypt` returns them concatenated
 * (tag last) — `split`/`concat` below bridge that so the two implementations
 * produce and accept the exact same serialized string for the same key.
 */

const VERSION = 'v1';
const IV_LENGTH = 12;
const TAG_LENGTH_BYTES = 16;

export class PhiCryptoService {
  private readonly keyPromise: Promise<CryptoKey>;

  constructor(rawKey: Uint8Array) {
    this.keyPromise = crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  }

  async encrypt(plaintext: string): Promise<string> {
    const key = await this.keyPromise;
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const combined = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: TAG_LENGTH_BYTES * 8 },
        key,
        new TextEncoder().encode(plaintext),
      ),
    );
    const data = combined.slice(0, combined.length - TAG_LENGTH_BYTES);
    const authTag = combined.slice(combined.length - TAG_LENGTH_BYTES);
    return [VERSION, bytesToBase64(iv), bytesToBase64(authTag), bytesToBase64(data)].join('.');
  }

  async decrypt(ciphertext: string): Promise<string> {
    const parts = ciphertext.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('Malformed or unsupported PHI ciphertext');
    }
    const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
    const key = await this.keyPromise;
    const iv = base64ToBytes(ivB64);
    const combined = new Uint8Array([...base64ToBytes(dataB64), ...base64ToBytes(tagB64)]);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: TAG_LENGTH_BYTES * 8 },
      key,
      combined,
    );
    return new TextDecoder().decode(plaintext);
  }

  /** Deterministic SHA-256 hash for blind-index lookups (non-reversible). */
  blindIndex(value: string): Promise<string> {
    return sha256Hex(value.trim().toLowerCase());
  }

  /** Constant-time comparison to avoid timing attacks. */
  safeEquals(a: string, b: string): boolean {
    return constantTimeEqual(a, b);
  }
}

/**
 * WebCrypto-based primitives shared by the auth/PHI services. Pure Web
 * platform APIs (`crypto.subtle`, `crypto.getRandomValues`) — no `node:crypto`
 * and no `nodejs_compat` dependency, so these work identically in Workers,
 * Vitest (Miniflare), and a plain browser.
 */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `length` cryptographically random bytes, base64url-encoded (no padding). */
export function randomTokenBase64Url(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** `length` cryptographically random bytes, lower-case hex-encoded. */
export function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** Base64-encodes a UTF-8 string (e.g. for a Basic auth header). */
export function utf8ToBase64(input: string): string {
  return bytesToBase64(new TextEncoder().encode(input));
}

/** Base64url-encodes a UTF-8 string (e.g. for a mock JWT-shaped payload). */
export function utf8ToBase64Url(input: string): string {
  return bytesToBase64Url(new TextEncoder().encode(input));
}

/** A `length`-digit numeric code (e.g. an OTP), each digit uniformly random. */
export function randomDigits(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 10).toString()).join('');
}

/** Lower-case hex SHA-256 digest of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

/** Constant-time string comparison (equal-length inputs only compare safely). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Password hashing via PBKDF2-HMAC-SHA256, using the Workers runtime's
 * native Web Crypto API (`crypto.subtle`) instead of bcrypt.
 *
 * Why not bcrypt: there's no native `bcrypt` binding Workers can load, and
 * the pure-JS `bcryptjs` fallback this used to use intermittently exceeded
 * the Workers Free plan's 10ms CPU-time-per-request cap at a secure cost
 * factor — confirmed in production as Cloudflare error 1102 on register/
 * login, roughly half the time (pure-JS bcrypt's timing isn't deterministic
 * enough to reliably stay under 10ms). `crypto.subtle` runs as native code
 * in the runtime, not interpreted JS, so PBKDF2 at a secure iteration count
 * comfortably fits under that cap without needing the Workers Paid plan.
 *
 * Hash format: `pbkdf2$<iterations>$<salt-b64>$<derived-key-b64>` — the
 * iteration count travels with the hash so a future bump to
 * PASSWORD_PBKDF2_ITERATIONS doesn't break verifying older hashes.
 *
 * This is a different format from the `$2b$...` bcrypt hashes this Worker
 * used to produce (and from apps/api's own native-bcrypt hashes) — nothing
 * live depends on that compatibility: apps/api never went into real
 * production use (see root CLAUDE.md), and the only existing hashes in the
 * Neon database are a handful of throwaway smoke-test accounts.
 */

const SALT_BYTES = 16;
const DERIVED_KEY_BITS = 256;

export class PasswordService {
  constructor(private readonly iterations: number) {}

  async hash(plain: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const derived = await deriveBits(plain, salt, this.iterations);
    return `pbkdf2$${this.iterations}$${toBase64(salt)}$${toBase64(derived)}`;
  }

  async compare(plain: string, stored: string): Promise<boolean> {
    const parsed = parseHash(stored);
    if (!parsed) return false;
    const derived = await deriveBits(plain, parsed.salt, parsed.iterations);
    return timingSafeEqual(derived, parsed.hash);
  }
}

/** A fixed, valid-format hash used to equalize login timing on unknown accounts. */
export const DUMMY_PASSWORD_HASH =
  'pbkdf2$600000$3we/+RjaWO7td0HyQqGzFg==$rrB3LXikXWZHva2FifgP7oHYTmQib5AsMSOTW0JlYN4=';

async function deriveBits(plain: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(plain),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    DERIVED_KEY_BITS,
  );
  return new Uint8Array(bits);
}

function parseHash(stored: string): { iterations: number; salt: Uint8Array; hash: Uint8Array } | null {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return null;
  try {
    return { iterations, salt: fromBase64(parts[2]!), hash: fromBase64(parts[3]!) };
  } catch {
    return null;
  }
}

/** Constant-time for any two byte arrays of the same length (our derived keys always are). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

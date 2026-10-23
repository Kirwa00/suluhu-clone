import bcrypt from 'bcryptjs';

/**
 * Password hashing — port of
 * apps/api/src/modules/auth/services/password.service.ts using `bcryptjs`
 * (pure JS) instead of the native `bcrypt` binding Workers can't load.
 * `bcryptjs` produces the same `$2b$` hash format at the same cost factor,
 * so existing hashes created by apps/api verify here unchanged, and vice
 * versa.
 */
export class PasswordService {
  constructor(private readonly saltRounds: number) {}

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.saltRounds);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}

/** A fixed bcrypt hash used to equalize timing on unknown accounts. */
export const DUMMY_PASSWORD_HASH = '$2b$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012';

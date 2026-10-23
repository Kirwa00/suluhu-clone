import { AppException } from './app-exception';

/**
 * Narrows an optional `c.get(...)` value set by an earlier middleware, for
 * handlers that run after it and know it's present. Hono's `Variables`
 * typing can't express "set by middleware X" as non-optional, so this is the
 * (cheap, always-correct) alternative to a non-null assertion.
 */
export function must<T>(value: T | undefined, message = 'Authentication required'): T {
  if (value === undefined) throw AppException.unauthorized(message);
  return value;
}

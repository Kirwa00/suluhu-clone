import type { AuthUser } from '@suluhu/shared';
import type { Bindings, Env } from './env';
import type { AuthContext } from './lib/context';

/**
 * Variables threaded through `c.get`/`c.set` across middleware and route
 * handlers. `ctx`/`user`/`authJti` are optional at the type level because
 * not every route sets them (health never does; auth/users routes do, via
 * `withAuthContext()`/`requireAuth()`) — handlers that need them use
 * `mustGet` below rather than a non-null assertion.
 */
export interface AppVariables {
  requestId: string;
  validatedEnv: Env;
  ctx?: AuthContext;
  user?: AuthUser;
  authJti?: string;
}

export type AppEnv = { Bindings: Bindings; Variables: AppVariables };

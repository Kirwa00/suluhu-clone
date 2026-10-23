import { describe, expect, it } from 'vitest';
import { GoogleIdentityService } from '../src/lib/google-identity';

describe('GoogleIdentityService', () => {
  it('rejects when Google sign-in is disabled (no client id configured)', async () => {
    const service = new GoogleIdentityService(undefined);
    await expect(service.verify('whatever')).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('rejects a malformed credential', async () => {
    const service = new GoogleIdentityService('some-client-id.apps.googleusercontent.com');
    await expect(service.verify('not-a-jwt')).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });
});

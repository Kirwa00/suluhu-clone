import { describe, expect, it } from 'vitest';
import { normalizeDailyDomain } from '../src/lib/daily-provider';
import { MockVideoProvider } from '../src/lib/video-provider';

describe('MockVideoProvider', () => {
  const provider = new MockVideoProvider();

  it('creates a room with a derived, prefixed name', async () => {
    const room = await provider.createRoom({
      appointmentId: '11111111-2222-3333-4444-555555555555',
    });
    expect(room.roomName).toMatch(/^suluhu-11111111-[0-9a-f]{8}$/);
    expect(room.roomUrl).toBe(`https://mock.daily.co/${room.roomName}`);
  });

  it('creates a token encoding the room/user/role/exp binding', async () => {
    const token = await provider.createToken({
      roomName: 'suluhu-abc123',
      userId: 'user-1',
      userName: 'Asha',
      isOwner: true,
      ttlSeconds: 300,
    });
    expect(token.token.startsWith('mockvt.')).toBe(true);
    const payload = JSON.parse(
      atob(token.token.slice('mockvt.'.length).replace(/-/g, '+').replace(/_/g, '/')),
    );
    expect(payload).toMatchObject({ r: 'suluhu-abc123', u: 'user-1', o: true });
    expect(new Date(token.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('normalizeDailyDomain', () => {
  it('appends .daily.co to a bare subdomain', () => {
    expect(normalizeDailyDomain('suluhu')).toBe('suluhu.daily.co');
  });

  it('passes through an already-qualified domain', () => {
    expect(normalizeDailyDomain('suluhu.daily.co')).toBe('suluhu.daily.co');
  });

  it('strips a scheme and trailing path/slash', () => {
    expect(normalizeDailyDomain('https://suluhu.daily.co/')).toBe('suluhu.daily.co');
  });
});

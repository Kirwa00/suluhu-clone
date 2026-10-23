import { randomHex, utf8ToBase64Url } from './crypto';

/**
 * Video session provider — port of
 * apps/api/src/modules/sessions/providers/video.provider.ts. The backend
 * creates a room per appointment and issues short-lived, meeting-scoped
 * tokens bound to a specific user, so unauthorized joins are impossible. The
 * mock returns plausible room URLs/tokens so the consult-room flow works
 * without Daily credentials (VIDEO_MODE=mock).
 */

export interface VideoRoom {
  roomName: string;
  roomUrl: string;
}

export interface VideoToken {
  token: string;
  expiresAt: string; // ISO
}

export interface CreateTokenOptions {
  roomName: string;
  userId: string;
  userName: string;
  isOwner: boolean;
  ttlSeconds: number;
}

export interface VideoProvider {
  readonly mode: 'mock' | 'live';
  createRoom(opts: { appointmentId: string }): Promise<VideoRoom>;
  createToken(opts: CreateTokenOptions): Promise<VideoToken>;
  /** URL a participant loads to join `roomName`, for rooms persisted earlier. */
  roomUrl(roomName: string): string;
}

export class MockVideoProvider implements VideoProvider {
  readonly mode = 'mock' as const;

  roomUrl(roomName: string): string {
    return `https://mock.daily.co/${roomName}`;
  }

  async createRoom(opts: { appointmentId: string }): Promise<VideoRoom> {
    const roomName = `suluhu-${opts.appointmentId.slice(0, 8)}-${randomHex(4)}`;
    console.log(`Created video room ${roomName}`);
    return { roomName, roomUrl: this.roomUrl(roomName) };
  }

  async createToken(opts: CreateTokenOptions): Promise<VideoToken> {
    const expiresAt = new Date(Date.now() + opts.ttlSeconds * 1000).toISOString();
    // Mock token encodes the binding (room + user + role + exp) like a real JWT would.
    const payload = utf8ToBase64Url(
      JSON.stringify({
        r: opts.roomName,
        u: opts.userId,
        o: opts.isOwner,
        exp: Math.floor(Date.parse(expiresAt) / 1000),
      }),
    );
    return { token: `mockvt.${payload}`, expiresAt };
  }
}

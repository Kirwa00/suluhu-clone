import { randomHex } from './crypto';
import type { CreateTokenOptions, VideoProvider, VideoRoom, VideoToken } from './video-provider';

/**
 * Daily.co live video provider — port of
 * apps/api/src/modules/sessions/providers/daily.provider.ts.
 *
 * Rooms are created `private` and knowledge of the room URL alone grants no
 * access: every participant needs a short-lived meeting token minted here
 * and bound to the room, the user id and the owner/guest role. Rooms also
 * carry their own expiry with `eject_at_room_exp`, so an abandoned consult
 * room cannot be rejoined long after the appointment window closed.
 *
 * API reference: https://docs.daily.co/reference/rest-api
 */

export interface DailyConfig {
  apiKey: string;
  /** Daily subdomain, either `suluhu` or `suluhu.daily.co`. */
  domain: string;
  /** Override for testing; defaults to Daily's production API. */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = 'https://api.daily.co/v1';

/** How long a created room stays joinable. Tokens are far shorter-lived. */
const ROOM_TTL_SECONDS = 4 * 60 * 60;

/** Normalizes `suluhu`, `suluhu.daily.co` or a full URL to `suluhu.daily.co`. */
export function normalizeDailyDomain(domain: string): string {
  const host = domain
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
  return host.includes('.') ? host : `${host}.daily.co`;
}

interface DailyRoomResponse {
  name?: string;
  url?: string;
}

interface DailyTokenResponse {
  token?: string;
}

export class DailyVideoProvider implements VideoProvider {
  readonly mode = 'live' as const;
  private readonly baseUrl: string;
  private readonly domain: string;

  constructor(private readonly config: DailyConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.domain = normalizeDailyDomain(config.domain);
  }

  roomUrl(roomName: string): string {
    return `https://${this.domain}/${roomName}`;
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    if (!res.ok) {
      console.error(`Daily POST ${path} failed (${res.status}): ${raw}`);
      throw new Error(`Daily POST ${path} failed with status ${res.status}`);
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      console.error(`Daily POST ${path} returned non-JSON response: ${raw}`);
      throw new Error(`Daily POST ${path} returned an unparseable response`);
    }
  }

  async createRoom(opts: { appointmentId: string }): Promise<VideoRoom> {
    const roomName = `suluhu-${opts.appointmentId.slice(0, 8)}-${randomHex(4)}`;
    const exp = Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS;

    const room = await this.request<DailyRoomResponse>('/rooms', {
      name: roomName,
      privacy: 'private',
      properties: {
        exp,
        eject_at_room_exp: true,
        enable_prejoin_ui: true,
        enable_chat: true,
        // Consult rooms are 1:1 (patient + therapist); no recording by default.
        enable_recording: false,
        max_participants: 2,
      },
    });

    const name = room.name ?? roomName;
    console.log(`Created Daily room ${name} for appointment ${opts.appointmentId}`);
    return { roomName: name, roomUrl: room.url ?? this.roomUrl(name) };
  }

  async createToken(opts: CreateTokenOptions): Promise<VideoToken> {
    const expSeconds = Math.floor(Date.now() / 1000) + opts.ttlSeconds;

    const res = await this.request<DailyTokenResponse>('/meeting-tokens', {
      properties: {
        room_name: opts.roomName,
        user_id: opts.userId,
        user_name: opts.userName,
        is_owner: opts.isOwner,
        exp: expSeconds,
        // The therapist (owner) may admit and eject; the patient may not.
        enable_screenshare: true,
      },
    });

    if (!res.token) {
      throw new Error('Daily meeting-token response missing a token');
    }
    return { token: res.token, expiresAt: new Date(expSeconds * 1000).toISOString() };
  }
}

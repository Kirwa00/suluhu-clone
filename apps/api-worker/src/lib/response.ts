import { API_VERSION, type ApiResponse } from '@suluhu/shared';

/** Wraps successful data in the standard envelope (SDLC §9.1). */
export function successEnvelope<T>(data: T, requestId: string | undefined): ApiResponse<T> {
  return {
    success: true,
    data: data ?? null,
    meta: { timestamp: new Date().toISOString(), version: API_VERSION, requestId },
    error: null,
  };
}

/** Wraps an error in the standard envelope. Mirrors AllExceptionsFilter. */
export function errorEnvelope(
  code: string,
  message: string,
  requestId: string | undefined,
  details?: Record<string, string[]>,
): ApiResponse<null> {
  return {
    success: false,
    data: null,
    meta: { timestamp: new Date().toISOString(), version: API_VERSION, requestId },
    error: { code, message, details },
  };
}

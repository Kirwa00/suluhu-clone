import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ErrorCode } from '@suluhu/shared';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma';
import { AppException } from './app-exception';
import { errorEnvelope } from './response';
import type { AppEnv } from '../types';

/**
 * Converts every thrown error into the standard envelope. Never leaks stack
 * traces to clients; logs them server-side instead. Port of
 * apps/api/src/common/filters/all-exceptions.filter.ts — same resolution
 * order and same error codes, so a client can't tell which backend answered.
 */
export function onError(error: unknown, c: Context<AppEnv>): Response {
  const requestId = c.get('requestId');
  const { status, code, message, details } = resolve(error);

  if (status >= 500) {
    console.error(
      `${c.req.method} ${c.req.path} -> ${status} ${code}`,
      error instanceof Error ? error.stack : String(error),
    );
  } else {
    console.warn(`${c.req.method} ${c.req.path} -> ${status} ${code}: ${message}`);
  }

  return c.json(errorEnvelope(code, message, requestId, details), status as 400);
}

function resolve(error: unknown): {
  status: number;
  code: string;
  message: string;
  details?: Record<string, string[]>;
} {
  if (error instanceof AppException) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const path = issue.path.join('.') || '_';
      (details[path] ??= []).push(issue.message);
    }
    return {
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Validation failed',
      details,
    };
  }

  if (error instanceof HTTPException) {
    return { status: error.status, code: httpStatusToCode(error.status), message: error.message };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return {
        status: 409,
        code: ErrorCode.CONFLICT,
        message: 'A record with these details already exists',
      };
    }
    if (error.code === 'P2025') {
      return {
        status: 404,
        code: ErrorCode.NOT_FOUND,
        message: 'The requested resource was not found',
      };
    }
  }

  return {
    status: 500,
    code: ErrorCode.INTERNAL,
    message: 'An unexpected error occurred. Please try again.',
  };
}

function httpStatusToCode(status: number): string {
  switch (status) {
    case 401:
      return ErrorCode.UNAUTHENTICATED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 429:
      return ErrorCode.RATE_LIMITED;
    case 400:
      return ErrorCode.VALIDATION_FAILED;
    default:
      return ErrorCode.INTERNAL;
  }
}

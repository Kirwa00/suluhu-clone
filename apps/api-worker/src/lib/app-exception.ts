import { ErrorCode } from '@suluhu/shared';

/**
 * Domain exception carrying a stable machine-readable code plus an HTTP
 * status. Port of apps/api/src/common/exceptions/app.exception.ts — same
 * codes, same static factories, so callers on either backend get identical
 * error shapes.
 */
export class AppException extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppException';
  }

  static badRequest(message: string, code: string = ErrorCode.VALIDATION_FAILED): AppException {
    return new AppException(code, message, 400);
  }

  static unauthorized(
    message = 'Authentication required',
    code: string = ErrorCode.UNAUTHENTICATED,
  ): AppException {
    return new AppException(code, message, 401);
  }

  static forbidden(message = 'You do not have access to this resource'): AppException {
    return new AppException(ErrorCode.FORBIDDEN, message, 403);
  }

  static notFound(message = 'Resource not found'): AppException {
    return new AppException(ErrorCode.NOT_FOUND, message, 404);
  }

  static conflict(message: string, code: string = ErrorCode.CONFLICT): AppException {
    return new AppException(code, message, 409);
  }

  static validation(
    details: Record<string, string[]>,
    message = 'Validation failed',
  ): AppException {
    return new AppException(ErrorCode.VALIDATION_FAILED, message, 400, details);
  }

  static serviceUnavailable(message = 'Dependencies not ready'): AppException {
    return new AppException(ErrorCode.INTERNAL, message, 503);
  }
}

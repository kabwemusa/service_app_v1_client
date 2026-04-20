export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BOOKING_CONFLICT'
  | 'PAYMENT_FAILED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'SESSION_EXPIRED';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly errors: Record<string, string[]> | null;
  readonly statusCode: number;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number = 0,
    errors: Record<string, string[]> | null = null,
  ) {
    super(message);
    this.name       = 'ApiError';
    this.code       = code;
    this.statusCode = statusCode;
    this.errors     = errors;
  }

  /** Returns the first error message for a given field, or null. */
  fieldError(field: string): string | null {
    return this.errors?.[field]?.[0] ?? null;
  }

  get isValidation(): boolean {
    return this.code === 'VALIDATION_ERROR';
  }

  get isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR';
  }

  get isSessionExpired(): boolean {
    return this.code === 'SESSION_EXPIRED';
  }
}

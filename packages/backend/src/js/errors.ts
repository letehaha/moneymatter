import { API_ERROR_CODES } from '@bt/shared/types';

export enum ERROR_CODES {
  BadRequest = 400,
  Unauthorized = 401,
  Forbidden = 403,
  NotFoundError = 404,
  NotAllowed = 405,
  ConflictError = 409,
  PayloadTooLarge = 413,
  ValidationError = 422,
  Locked = 423,
  TooManyRequests = 429,
  UnexpectedError = 500,
  BadGateway = 502,
  ServiceUnavailable = 503,
  PaymentRequired = 402,
}

export class CustomError extends Error {
  public httpCode: number;
  public code: API_ERROR_CODES;
  public details: Record<string, unknown> | undefined;

  constructor(httpCode, code: API_ERROR_CODES, message: string, details?: Record<string, unknown>) {
    super(message);

    this.httpCode = httpCode;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends CustomError {
  constructor({
    code = API_ERROR_CODES.BadRequest,
    message,
    details,
  }: {
    code?: API_ERROR_CODES;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(ERROR_CODES.BadRequest, code, message, details);
  }
}

export class Unauthorized extends CustomError {
  constructor({ code = API_ERROR_CODES.unauthorized, message }: { code?: API_ERROR_CODES; message: string }) {
    super(ERROR_CODES.Unauthorized, code, message);
  }
}

export class NotFoundError extends CustomError {
  constructor({
    code = API_ERROR_CODES.notFound,
    message,
    details,
  }: {
    code?: API_ERROR_CODES;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(ERROR_CODES.NotFoundError, code, message, details);
  }
}

export class NotAllowedError extends CustomError {
  constructor({ code = API_ERROR_CODES.notAllowed, message }: { code?: API_ERROR_CODES; message: string }) {
    super(ERROR_CODES.NotAllowed, code, message);
  }
}

export class ConflictError extends CustomError {
  constructor({
    code = API_ERROR_CODES.conflict,
    message,
    details,
  }: {
    code?: API_ERROR_CODES;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(ERROR_CODES.ConflictError, code, message, details);
  }
}

export class ValidationError extends CustomError {
  constructor({
    code = API_ERROR_CODES.validationError,
    message,
    details,
  }: {
    code?: API_ERROR_CODES;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(ERROR_CODES.ValidationError, code, message, details);
  }
}

export class ForbiddenError extends CustomError {
  constructor({
    code = API_ERROR_CODES.forbidden,
    message,
    details,
  }: {
    code?: API_ERROR_CODES;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(ERROR_CODES.Forbidden, code, message, details);
  }
}

export class UnexpectedError extends CustomError {
  constructor({
    code = API_ERROR_CODES.unexpected,
    message = 'Unexpected error',
  }: { code?: API_ERROR_CODES; message?: string } = {}) {
    super(ERROR_CODES.UnexpectedError, code, message);
  }
}

/** No exchange rate exists for the pair on or before the requested date. */
export class ExchangeRateUnavailableError extends UnexpectedError {}

export class PayloadTooLargeError extends CustomError {
  constructor({
    code = API_ERROR_CODES.payloadTooLarge,
    message,
    details,
  }: {
    code?: API_ERROR_CODES;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(ERROR_CODES.PayloadTooLarge, code, message, details);
  }
}

export class TooManyRequests extends CustomError {
  constructor({
    code = API_ERROR_CODES.tooManyRequests,
    message,
    details,
  }: {
    code?: API_ERROR_CODES;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(ERROR_CODES.TooManyRequests, code, message, details);
  }
}

export class BadGateway extends CustomError {
  constructor({
    code = API_ERROR_CODES.badGateway,
    message,
    details,
  }: {
    code?: API_ERROR_CODES;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(ERROR_CODES.BadGateway, code, message, details);
  }
}

export class ServiceUnavailableError extends CustomError {
  constructor({
    code = API_ERROR_CODES.serviceUnavailable,
    message,
    details,
  }: {
    code?: API_ERROR_CODES;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(ERROR_CODES.ServiceUnavailable, code, message, details);
  }
}

/**
 * Represents an error when a resource is locked and cannot be processed.
 * Corresponds to HTTP status 423 Locked.
 */
export class LockedError extends CustomError {
  constructor({
    code = API_ERROR_CODES.locked,
    message,
    details,
  }: {
    code?: API_ERROR_CODES;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(ERROR_CODES.Locked, code, message, details);
  }
}

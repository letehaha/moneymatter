import { API_ERROR_CODES, API_RESPONSE_STATUS } from '@bt/shared/types';
import { CustomResponse } from '@common/types';
import { t } from '@i18n/index';
import { CustomError } from '@js/errors';
import { logger } from '@js/utils/logger';

/** Structural stand-in for better-auth's `isAPIError` — its `better-auth/api` subpath types
 *  don't resolve under this tsconfig, and the real guard also falls back to a name check. */
export const isAuthApiError = (
  e: unknown,
): e is Error & { statusCode: number; body?: { message?: string; code?: string } } =>
  e instanceof Error && e.name === 'APIError' && typeof (e as { statusCode?: unknown }).statusCode === 'number';

const BETTER_AUTH_ERROR_KEYS: Record<string, string> = {
  PASSWORD_ALREADY_SET: 'auth.errors.passwordAlreadySet',
  PASSWORD_TOO_SHORT: 'auth.errors.passwordTooShort',
  PASSWORD_TOO_LONG: 'auth.errors.passwordTooLong',
  SESSION_EXPIRED: 'auth.errors.reauthenticationRequired',
};

export function errorHandler(res: CustomResponse, err: Error) {
  if (err instanceof CustomError) {
    return res.status(err.httpCode).json({
      status: API_RESPONSE_STATUS.error,
      response: {
        message: err.message,
        code: err.code,
        details: err.details,
      },
    });
  }

  // better-auth throws its own APIError from `auth.api.*` calls, carrying the status and a
  // machine-readable code the frontend keys off (e.g. PASSWORD_ALREADY_SET → 400).
  if (isAuthApiError(err)) {
    if (err.statusCode >= 500) logger.error(err);
    const code = err.body?.code;
    const key = code ? BETTER_AUTH_ERROR_KEYS[code] : undefined;
    return res.status(err.statusCode).json({
      status: API_RESPONSE_STATUS.error,
      response: {
        message: key ? t({ key }) : (err.body?.message ?? err.message),
        code,
      },
    });
  }

  logger.error(err as Error);
  return res.status(500).json({
    status: API_RESPONSE_STATUS.error,
    response: {
      message: t({ key: 'errors.unexpected' }),
      code: API_ERROR_CODES.unexpected,
    },
  });
}

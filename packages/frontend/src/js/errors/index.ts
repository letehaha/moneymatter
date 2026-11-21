import { ApiBaseError } from '@/common/types';
import { API_ERROR_CODES, type PayeeNameConflictDetails } from '@bt/shared/types';

export * from './network.error';
export * from './auth.error';
export * from './unexpected.error';
export * from './oauth-provider-not-configured.error';
export * from './auth-error-message';

export class ApiErrorResponseError extends Error {
  data: ApiBaseError;

  constructor(message: string, data: ApiBaseError) {
    super(message);

    this.data = data;
  }
}

/**
 * Type guard: true iff `error` is an `ApiErrorResponseError` carrying the given
 * API error code. Prefer this over inlining `err instanceof ApiErrorResponseError &&
 * err.data?.code === ...` at call sites — keeps the unwrap shape in one place and
 * narrows `error` so `error.data` is accessible without re-asserting the type.
 */
export const isApiErrorWithCode = (error: unknown, code: API_ERROR_CODES): error is ApiErrorResponseError =>
  error instanceof ApiErrorResponseError && error.data?.code === code;

export const isNotFoundError = (error: unknown): error is ApiErrorResponseError =>
  isApiErrorWithCode(error, API_ERROR_CODES.notFound);

/**
 * Single source for unwrapping the server's message off an `ApiErrorResponseError` — the
 * API client throws this class with `data: { code, message, details }`, so the common
 * reflex of reading `err.response.data.response.message` silently returns undefined.
 * Mutation handlers pair it with a fallback key: `extractApiErrorMessage(err) || t(key)`.
 */
export const extractApiErrorMessage = (error: unknown): string | undefined =>
  error instanceof ApiErrorResponseError ? error.data?.message : undefined;

/**
 * The API client already logs out on 401 and toasts a 402 with a "See plans" action,
 * so a second toast would blame the operation for it.
 */
export const isHandledByApiClient = ({ error }: { error: unknown }) =>
  isApiErrorWithCode(error, API_ERROR_CODES.unauthorized) || isApiErrorWithCode(error, API_ERROR_CODES.planRequired);

/**
 * Detects whether every Zod validation failure on the response originated from
 * a URL path/query param (e.g. `params.id`) rather than the request body.
 * A request that fails purely on URL params never reaches the resource, which
 * is UX-equivalent to a 404 for that URL.
 */
const isPurelyUrlParamValidationError = (error: ApiErrorResponseError): boolean => {
  if (error.data?.code !== API_ERROR_CODES.validationError) return false;
  const validationErrors = (error.data as unknown as Record<string, unknown>)?.validationErrors;
  if (!Array.isArray(validationErrors) || validationErrors.length === 0) return false;
  return validationErrors.every((v) => {
    const path = (v as { path?: unknown }).path;
    return Array.isArray(path) && (path[0] === 'params' || path[0] === 'query');
  });
};

/**
 * Treats both a real NotFound and a URL-param validation failure as "resource
 * unavailable for this URL." Page-level resource fetches (e.g. `/portfolios/:id`)
 * should use this to render an empty/not-found state for any URL that can't
 * resolve to a real record — including malformed IDs typed into the address bar.
 *
 * Body-level validation errors (mutations, form submits) are NOT covered here —
 * those should keep producing field-level error UI, not a "not found" page.
 */
export const isResourceMissingError = (error: unknown): error is ApiErrorResponseError => {
  if (isApiErrorWithCode(error, API_ERROR_CODES.notFound)) return true;
  if (!(error instanceof ApiErrorResponseError)) return false;
  return isPurelyUrlParamValidationError(error);
};

/**
 * Extracts the first validation error message from an ApiErrorResponseError.
 * Returns undefined if the error is not a validation error or has no messages.
 */
const getFirstValidationMessage = ({ error }: { error: ApiErrorResponseError }): string | undefined => {
  const validationErrors = (error.data as unknown as Record<string, unknown>)?.validationErrors;
  if (Array.isArray(validationErrors) && validationErrors[0]?.message) {
    return validationErrors[0].message as string;
  }
  return undefined;
};

/**
 * Extracts the `details.conflictingPayee` payload from a 409 returned by payee
 * name/alias writes (see `PayeeNameConflictDetails` in shared types). The
 * runtime field checks guard against the backend shape drifting — on mismatch
 * the caller falls back to the plain server message instead of rendering a
 * broken link.
 */
export const getPayeeNameConflict = (error: unknown): PayeeNameConflictDetails['conflictingPayee'] | null => {
  if (!isApiErrorWithCode(error, API_ERROR_CODES.conflict)) return null;
  const candidate = (error.data.details as Partial<PayeeNameConflictDetails> | undefined)?.conflictingPayee;
  return candidate && typeof candidate.id === 'string' && typeof candidate.name === 'string' ? candidate : null;
};

/**
 * Maps an API error to a user-facing message.
 * - Conflict errors use the provided conflictKey
 * - Validation errors extract the first Zod validation message
 * - Everything else uses the fallbackKey
 */
export const getApiErrorMessage = ({
  e,
  t,
  conflictKey,
  fallbackKey,
}: {
  e: unknown;
  t: (key: string) => string;
  conflictKey: string;
  fallbackKey: string;
}): string => {
  if (isApiErrorWithCode(e, API_ERROR_CODES.conflict)) {
    return t(conflictKey);
  }
  if (isApiErrorWithCode(e, API_ERROR_CODES.validationError)) {
    return getFirstValidationMessage({ error: e }) || t(fallbackKey);
  }
  return t(fallbackKey);
};

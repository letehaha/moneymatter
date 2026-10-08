import { API_ERROR_CODES, API_RESPONSE_STATUS } from '@bt/shared/types/api';
import { CustomResponse } from '@common/types';
import { errorHandler } from '@controllers/helpers';
import { ERROR_CODES } from '@js/errors';
import { NextFunction, Request } from 'express';
import { ZodError, ZodType, z } from 'zod';

/** Every controller schema parses to an object, so a successful parse is never falsy. */
export type RequestShape = { params?: unknown; query?: unknown; body?: unknown };

/** Parses body/params/query. On a Zod failure writes the 422 and returns undefined; any other error propagates. */
export function validateRequest<T extends ZodType<RequestShape>>({
  schema,
  req,
  res,
}: {
  schema: T;
  req: Request;
  res: CustomResponse;
}): z.infer<T> | undefined {
  try {
    return schema.parse({
      body: req.body,
      params: req.params,
      query: req.query,
    });
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;

    const message = error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    res.status(ERROR_CODES.ValidationError).json({
      status: API_RESPONSE_STATUS.error,
      response: {
        message,
        validationErrors: error.issues,
        code: API_ERROR_CODES.validationError,
      },
    });
    return undefined;
  }
}

/**
 * Controllers built with `createController` validate on their own. Mount this
 * only when a bad request must be rejected before the middleware ahead of the
 * controller runs (e.g. so it doesn't consume a rate-limit slot).
 */
export const validateEndpoint =
  <T extends ZodType<RequestShape>>(schema: T) =>
  (req: Request, res: CustomResponse, next: NextFunction) => {
    try {
      if (validateRequest({ schema, req, res })) next();
    } catch (error) {
      errorHandler(res, error as Error);
    }
  };

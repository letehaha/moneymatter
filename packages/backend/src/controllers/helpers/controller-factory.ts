import { API_RESPONSE_STATUS } from '@bt/shared/types';
import { CustomRequest, CustomResponse } from '@common/types';
import { errorHandler } from '@controllers/helpers';
import { RequestShape, validateRequest } from '@middlewares/validations';
import { runWithBalanceRevalueBatch } from '@services/balances/revalue-balance-history.service';
import { Request, Response } from 'express';
import { z } from 'zod';

type ValidatedData<T extends z.ZodType<RequestShape>> = z.infer<T>;

type HandlerParams<T extends z.ZodType<RequestShape>> = {
  user: CustomRequest['user'];
  params: ValidatedData<T> extends { params: infer P } ? P : Record<string, never>;
  query: ValidatedData<T> extends { query: infer Q } ? Q : Record<string, never>;
  body: ValidatedData<T> extends { body: infer B } ? B : Record<string, never>;
  req: Request;
  res: Response;
};

type ControllerResponse<T = unknown> = {
  data?: T;
  statusCode?: number;
};

type HandlerFunction<T extends z.ZodType<RequestShape>> = (
  params: HandlerParams<T>,
) => Promise<ControllerResponse | void>;

/**
 * Builds an Express handler that validates the request against `schema` and
 * wraps `handler` in the standard JSON envelope. Mount it directly:
 * `router.get('/', authenticateSession, getTags)`.
 */
export function createController<T extends z.ZodType<RequestShape>>(schema: T, handler: HandlerFunction<T>) {
  return async (req: Request, res: CustomResponse): Promise<CustomResponse> => {
    try {
      const validated = validateRequest({ schema, req, res });
      if (!validated) return res;

      // One revalue scope per request, so the rebuilds finish before `res` is written.
      const result = await runWithBalanceRevalueBatch(() =>
        handler({
          req,
          res,
          user: (req as CustomRequest).user,
          params: validated.params || {},
          query: validated.query || {},
          body: validated.body || {},
        } as HandlerParams<T>),
      );

      const statusCode = result?.statusCode || 200;

      // Handler may have written a non-JSON response directly (e.g. binary
      // file download). In that case the response is already committed and we
      // must not attempt to send the standard JSON envelope on top of it.
      if (res.headersSent) {
        return res;
      }

      if (!result || result.data === undefined) {
        return res.status(statusCode).json({
          status: API_RESPONSE_STATUS.success,
        });
      }

      return res.status(statusCode).json({
        status: API_RESPONSE_STATUS.success,
        response: result.data,
      });
    } catch (err) {
      return errorHandler(res, err as Error);
    }
  };
}

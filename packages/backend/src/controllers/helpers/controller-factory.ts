import { API_RESPONSE_STATUS } from '@bt/shared/types';
import { CustomRequest, CustomResponse } from '@common/types';
import { errorHandler } from '@controllers/helpers';
import { RequestShape, validateRequest } from '@middlewares/validations';
import { startBackgroundJob } from '@services/background-jobs/background-jobs.service';
import { runWithBalanceRevalueBatch } from '@services/balances/revalue-balance-history.service';
import { createHash } from 'crypto';
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
export function createController<T extends z.ZodType<RequestShape>>(
  schema: T,
  handler: HandlerFunction<T>,
  /** Answers 202 with a `backgroundJobId` at once and stores the real response for `GET /background-jobs/:jobId`. */
  {
    inBackground = false,
  }: { inBackground?: boolean | ((input: Pick<HandlerParams<T>, 'params' | 'query' | 'body'>) => boolean) } = {},
) {
  return async (req: Request, res: CustomResponse): Promise<CustomResponse> => {
    try {
      const validated = validateRequest({ schema, req, res });
      if (!validated) return res;

      const user = (req as CustomRequest).user;
      const input = {
        params: validated.params || {},
        query: validated.query || {},
        body: validated.body || {},
      } as Pick<HandlerParams<T>, 'params' | 'query' | 'body'>;

      const respond = async (target: CustomResponse): Promise<CustomResponse> => {
        try {
          // One revalue scope per request, so the rebuilds finish before `res` is written.
          const result = await runWithBalanceRevalueBatch(() =>
            handler({ ...input, req, res: target, user } as HandlerParams<T>),
          );

          const statusCode = result?.statusCode || 200;

          // Handler may have written a non-JSON response directly (e.g. binary
          // file download). In that case the response is already committed and we
          // must not attempt to send the standard JSON envelope on top of it.
          if (target.headersSent) {
            return target;
          }

          if (!result || result.data === undefined) {
            return target.status(statusCode).json({
              status: API_RESPONSE_STATUS.success,
            });
          }

          return target.status(statusCode).json({
            status: API_RESPONSE_STATUS.success,
            response: result.data,
          });
        } catch (err) {
          return errorHandler(target, err as Error);
        }
      };

      if (!(typeof inBackground === 'function' ? inBackground(input) : inBackground)) return await respond(res);

      const fingerprint = createHash('sha256')
        .update(`${req.method} ${req.originalUrl}\n`)
        .update(Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body ?? null))
        .digest('hex');
      const backgroundJobId = await startBackgroundJob({ userId: user.id, fingerprint, run: respond });
      return res.status(202).json({ status: API_RESPONSE_STATUS.success, response: { backgroundJobId } });
    } catch (err) {
      return errorHandler(res, err as Error);
    }
  };
}

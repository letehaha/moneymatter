import { isSelfHost } from '@config/is-self-host';
import { errorHandler } from '@controllers/helpers';
import { NotFoundError } from '@js/errors';
import type { NextFunction, Request, Response } from 'express';

/** Features that run local processes only exist on a self-hosted instance; the routes answer 404 elsewhere. */
export const selfHostOnly = (_req: Request, res: Response, next: NextFunction) => {
  if (!isSelfHost()) {
    return errorHandler(res, new NotFoundError({ message: 'Only available on self-hosted instances.' }));
  }
  return next();
};

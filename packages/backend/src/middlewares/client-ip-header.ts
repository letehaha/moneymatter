import type { NextFunction, Request, Response } from 'express';

/**
 * Carries Express's proxy-aware `req.ip` to better-auth, which sees only headers and can't tell a
 * proxy's `X-Forwarded-For` from a forged one.
 */
export const CLIENT_IP_HEADER = 'x-bt-client-ip';

/** Overwrites any caller-sent value. Must run before every handler that passes `req.headers` to better-auth. */
export function setClientIpHeaderMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (req.ip) req.headers[CLIENT_IP_HEADER] = req.ip;
  else delete req.headers[CLIENT_IP_HEADER];

  next();
}

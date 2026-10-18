import type { NextFunction, Request, Response } from 'express';

/**
 * Header that carries the client address from Express to better-auth. better-auth sees only request
 * headers, never the socket, so it cannot tell a proxy's `X-Forwarded-For` from a forged one. Express
 * can: `req.ip` follows `trust proxy`, reading `X-Forwarded-For` only when the socket peer is a
 * trusted proxy. better-auth reads this header through `advanced.ipAddress.ipAddressHeaders`.
 */
export const CLIENT_IP_HEADER = 'x-bt-client-ip';

/**
 * Sets `CLIENT_IP_HEADER` to `req.ip` on every request, replacing anything the caller sent, so the
 * value always comes from the server's own proxy trust and never from the client. Must run before
 * every handler that passes `req.headers` to better-auth.
 */
export function setClientIpHeaderMiddleware(req: Request, _res: Response, next: NextFunction) {
  const ip = req.ip?.replace(/^::ffff:/i, '');

  if (ip) req.headers[CLIENT_IP_HEADER] = ip;
  else delete req.headers[CLIENT_IP_HEADER];

  next();
}

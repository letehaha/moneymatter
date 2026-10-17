import type { NextFunction, Request, Response } from 'express';

/**
 * Cookies that Cloudflare Access adds to the requests it forwards to the origin.
 * The app never reads them. better-auth treats any cookie as a browser session
 * and then demands an `Origin` header, which MCP/OAuth clients do not send.
 */
const CLOUDFLARE_ACCESS_COOKIE_NAMES = new Set(['CF_Authorization', 'CF_AppSession']);

/**
 * Returns the `Cookie` header value without the Cloudflare Access cookies, or
 * `undefined` when nothing else is left. Every other segment is kept verbatim,
 * and input that is not a string yields `undefined`.
 */
export function stripCloudflareAccessCookies({ cookieHeader }: { cookieHeader: unknown }): string | undefined {
  if (typeof cookieHeader !== 'string') return undefined;

  const kept = cookieHeader
    .split(';')
    .map((segment) => segment.trim())
    .filter((segment) => {
      if (!segment) return false;
      const name = segment.split('=', 1)[0]!.trim();
      return !CLOUDFLARE_ACCESS_COOKIE_NAMES.has(name);
    });

  return kept.length ? kept.join('; ') : undefined;
}

/**
 * Removes the Cloudflare Access cookies from `req.headers.cookie`, so a request
 * that carried only those cookies reaches better-auth as a cookie-less one. A
 * request without a `Cookie` header passes through untouched.
 */
export function stripCloudflareAccessCookiesMiddleware(req: Request, _res: Response, next: NextFunction) {
  const original = req.headers.cookie;

  if (original !== undefined) {
    const stripped = stripCloudflareAccessCookies({ cookieHeader: original });

    if (stripped === undefined) delete req.headers.cookie;
    else if (stripped !== original) req.headers.cookie = stripped;
  }

  next();
}

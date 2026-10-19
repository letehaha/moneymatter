import type { NextFunction, Request, Response } from 'express';

// Cloudflare Access forwards these to the origin and the app never reads them. better-auth demands an
// `Origin` header whenever any cookie is present, so they break MCP/OAuth clients, which send none.
const CLOUDFLARE_ACCESS_COOKIE_NAMES = new Set(['CF_Authorization', 'CF_AppSession']);

export function stripCloudflareAccessCookies({ cookieHeader }: { cookieHeader: string }): string | undefined {
  const segments = cookieHeader.split(';');
  const kept = segments.filter((segment) => !CLOUDFLARE_ACCESS_COOKIE_NAMES.has(segment.split('=', 1)[0]!.trim()));
  if (kept.length === segments.length) return cookieHeader;

  return (
    kept
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join('; ') || undefined
  );
}

export function stripCloudflareAccessCookiesMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (req.headers.cookie) {
    const stripped = stripCloudflareAccessCookies({ cookieHeader: req.headers.cookie });
    if (stripped) req.headers.cookie = stripped;
    else delete req.headers.cookie;
  }

  next();
}

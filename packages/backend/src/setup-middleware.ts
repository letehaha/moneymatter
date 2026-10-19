import { isPerfDebugEnabled, perfDebugMiddleware } from '@common/lib/perf/perf-debug';
import { resolveTrustedProxies, TRUSTED_PROXIES_ENV } from '@config/trusted-proxies';
import { logger } from '@js/utils/logger';
import { setClientIpHeaderMiddleware } from '@middlewares/client-ip-header';
import { requestIdMiddleware } from '@middlewares/request-id';
import { sessionMiddleware } from '@middlewares/session-id';
import { stripCloudflareAccessCookiesMiddleware } from '@middlewares/strip-cloudflare-access-cookies';
import { MS_MONEY_FULL_PATHS } from '@routes/import-export/ms-money-paths';
import { OFX_FULL_PATHS } from '@routes/import-export/ofx-paths';
import cors from 'cors';
import express, { Express, Request } from 'express';
import morgan from 'morgan';

import { API_PREFIX } from './config';
import { addI18nextToRequest, detectLanguage } from './i18n/middleware';

export function setupMiddleware(app: Express) {
  // Drop the default `X-Powered-By: Express` info-disclosure header.
  app.disable('x-powered-by');

  // `req.ip` keys the per-IP rate limits and the address stored on auth sessions. Trusting private ranges
  // only (the default) means the first public address from the right wins, which a client cannot forge.
  app.set('trust proxy', resolveTrustedProxies({ raw: process.env[TRUSTED_PROXIES_ENV] }));

  app.use(requestIdMiddleware);

  app.use(setClientIpHeaderMiddleware);

  // Must run before the auth routes, including the register patch, which treats any cookie as a session.
  app.use(stripCloudflareAccessCookiesMiddleware);

  // Opt-in (PERF_DEBUG=true): tag responses with per-request query count + timing.
  if (isPerfDebugEnabled) {
    app.use(perfDebugMiddleware);
  }

  app.set('port', process.env.APPLICATION_PORT);

  // HSTS on the API host. Only emitted in production where TLS is terminated
  // by the reverse proxy; sending it over plain HTTP in dev would be a no-op
  // anyway, but this keeps response noise out of local logs.
  if (process.env.NODE_ENV === 'production') {
    app.use((_req, res, next) => {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
      next();
    });
  }

  // AUTH_ORIGIN is the frontend host – the primary CORS origin. ALLOWED_ORIGINS
  // is documented as "extra origins beyond AUTH_ORIGIN" (self-hosting/.env.example),
  // so seed AUTH_ORIGIN first. Without this, a self-host that sets only the
  // documented AUTH_ORIGIN gets an empty CORS allow-list and every preflight
  // returns 404 – auth POSTs silently fail in the browser.
  const authOrigin = (process.env.AUTH_ORIGIN || '').trim();
  const ALLOWED_ORIGINS = Array.from(
    new Set([
      ...(authOrigin ? [authOrigin] : []),
      ...(process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ]),
  );

  const isDevMode = process.env.NODE_ENV === 'development';
  const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

  // In dev mode, trust any localhost origin regardless of port/protocol.
  // Self-hosters frequently hit CORS due to minor URL mismatches (http vs https,
  // localhost vs 127.0.0.1, or a port number drift). This eliminates the class
  // of bug for local setups while leaving prod CORS strict to ALLOWED_ORIGINS.
  const isDevLocalhostOrigin = (origin: string): boolean => {
    if (!isDevMode) return false;
    try {
      const url = new URL(origin);
      return LOCALHOST_HOSTNAMES.has(url.hostname);
    } catch {
      return false;
    }
  };

  // MCP/OAuth paths must allow any origin (MCP spec requires CORS for browser-based clients
  // like Claude.ai that perform discovery and registration from the browser)
  const MCP_CORS_PREFIX_PATHS = ['/.well-known/', '/mcp', `${API_PREFIX}/auth/oauth2/`];
  // Claude.ai ignores AS metadata and hardcodes /authorize, /token, /register on the
  // base URL (see setup-routes.ts oauthProxyPaths). These 307-redirect endpoints still
  // need permissive CORS so the browser preflight succeeds before the redirect.
  // WARNING: keep in sync with oauthProxyPaths in setup-routes.ts.
  const MCP_CORS_EXACT_PATHS = new Set(['/authorize', '/token', '/register']);

  const mcpCors = cors({
    origin: true,
    credentials: true,
    exposedHeaders: ['x-session-id', 'x-request-id'],
  });

  const appCors = cors({
    origin(requestOrigin, callback) {
      if (process.env.NODE_ENV === 'test' || !requestOrigin) {
        return callback(null, true);
      }

      if (ALLOWED_ORIGINS.includes(requestOrigin) || isDevLocalhostOrigin(requestOrigin)) {
        return callback(null, true);
      }

      // Silently reject - don't throw error to avoid Sentry noise
      return callback(null, false);
    },
    credentials: true,
    exposedHeaders: ['x-session-id', 'x-request-id', 'server-timing', 'x-query-count', 'x-db-time-ms'],
  });

  app.use((req, res, next) => {
    const isMcpPath = MCP_CORS_PREFIX_PATHS.some((p) => req.path.startsWith(p)) || MCP_CORS_EXACT_PATHS.has(req.path);
    if (isMcpPath) {
      return mcpCors(req, res, next);
    }
    return appCors(req, res, next);
  });

  logger.info(`CORS configured with origins: ${ALLOWED_ORIGINS}`);

  // Paths that need raw body preserved (for signature verification)
  // Note: These paths should include the full path WITH API_PREFIX because
  // this middleware runs before route mounting, so req.path contains full path
  const rawBodyPaths = [`${API_PREFIX}/webhooks/github`, `${API_PREFIX}/webhooks/billing`];

  // Binary uploads: the body is a file, not JSON, and the route mounts its own
  // `express.raw` parser. Running the JSON parser here first would buffer a
  // multi-megabyte body a second time for nothing.
  const binaryUploadPaths: string[] = [MS_MONEY_FULL_PATHS.upload, OFX_FULL_PATHS.upload];

  // Body parser with conditional limits
  app.use((req, res, next) => {
    // Skip body parsing for better-auth routes – toNodeHandler reads the raw
    // request stream and re-parses the body itself.  If Express consumes the
    // stream first (especially for application/x-www-form-urlencoded), the
    // body gets re-serialized as JSON while the Content-Type header stays
    // urlencoded, causing a parsing mismatch in better-call.
    if (req.path.startsWith(`${API_PREFIX}/auth/`)) {
      return next();
    }

    if (binaryUploadPaths.includes(req.path)) {
      return next();
    }

    // Paths that need larger payloads
    const largePaths: Record<string, string[]> = {
      '1mb': [
        `${API_PREFIX}/investments/securities/prices/bulk-upload`,
        // A manual categorization run can carry up to AI_CATEGORIZATION_MAX_TRANSACTIONS_PER_RUN
        // transaction ids, which is ~200KB of UUIDs.
        `${API_PREFIX}/user/ai/categorization/trigger`,
        // A Money file can hold 100k transactions, so the duplicate row indices
        // the user chooses to skip outgrow the default limit on a big import.
        MS_MONEY_FULL_PATHS.detectDuplicates,
        MS_MONEY_FULL_PATHS.execute,
        OFX_FULL_PATHS.detectDuplicates,
        OFX_FULL_PATHS.execute,
      ],
      '10mb': [
        `${API_PREFIX}/import/csv/parse`,
        `${API_PREFIX}/import/csv/extract-unique-values`,
        `${API_PREFIX}/import/csv/detect-duplicates`,
        `${API_PREFIX}/import/csv/execute`,
        // Statement parser endpoints carry base64 encoded files on the way in
        // (max 10MB file = ~13.3MB base64) and the full extracted transactions
        // array on the way back out.
        `${API_PREFIX}/import/text-source/estimate-cost`,
        `${API_PREFIX}/import/text-source/extract`,
        `${API_PREFIX}/import/text-source/detect-duplicates`,
        `${API_PREFIX}/import/text-source/execute`,
        // Investment import: estimate-cost and extract carry the base64 encoded
        // file on the way in, execute carries the full per-holding transaction
        // arrays – all easily multi-MB for large broker exports.
        `${API_PREFIX}/investments/transactions-import/estimate-cost`,
        `${API_PREFIX}/investments/transactions-import/extract`,
        `${API_PREFIX}/investments/transactions-import/execute`,
        // YNAB register CSVs are sent inline as JSON-encoded text on both parse and execute.
        `${API_PREFIX}/import/ynab/parse`,
        `${API_PREFIX}/import/ynab/execute`,
        // Budget Bakers Wallet sends the whole CSV inline as `fileContent` on
        // every step of the flow.
        `${API_PREFIX}/import/budget-bakers-wallet/parse`,
        `${API_PREFIX}/import/budget-bakers-wallet/detect-duplicates`,
        `${API_PREFIX}/import/budget-bakers-wallet/execute`,
      ],
      // Backup restore carries the whole backup zip as a base64 JSON string; the
      // base64 envelope inflates ~4/3, so a ~40MB zip needs this ceiling.
      '64mb': [`${API_PREFIX}/user/backup/restore`],
    };

    // For webhook paths, preserve raw body for signature verification
    // Use req.originalUrl to ensure we match the full path regardless of mounting
    if (rawBodyPaths.some((p) => req.originalUrl.startsWith(p))) {
      return express.json({
        limit: '1mb',
        verify: (rawReq, _res, buf) => {
          (rawReq as Request & { rawBody?: Buffer }).rawBody = buf;
        },
      })(req, res, next);
    }

    // Check each limit size and apply if path matches
    for (const [limit, paths] of Object.entries(largePaths)) {
      if (paths.includes(req.path)) {
        return express.json({ limit })(req, res, next);
      }
    }

    return express.json()(req, res, next);
  });

  app.use((req, res, next) => {
    if (req.path.startsWith(`${API_PREFIX}/auth/`)) return next();
    express.urlencoded({ extended: false })(req, res, next);
  });
  if (process.env.NODE_ENV !== 'test') {
    morgan.token<Request>('url', (req) => req.originalUrl.replace(/(\/reset-password\/)[^/?]+/, '$1[redacted]'));
    app.use(morgan('dev'));
  }
  app.use(sessionMiddleware);
  // i18next language detection middleware (uses Accept-Language header from frontend)
  app.use(detectLanguage);
  app.use(addI18nextToRequest);
}

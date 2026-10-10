import { requestContext } from '@common/request-context';
import { logger } from '@js/utils/logger';
import { Sentry } from '@js/utils/sentry';
import { toNodeHandler } from 'better-auth/node';
import { Express, Request, Response } from 'express';
import http from 'node:http';

import { API_PREFIX } from './config';
import { auth, authPool } from './config/auth';
import { SUPPORTED_LOCALES } from './i18n';
import accountGroupsRoutes from './routes/account-groups';
import accountsRoutes from './routes/accounts.route';
import adminRoutes from './routes/admin.route';
import attachmentsRoutes from './routes/attachments.route';
import bankDataProvidersRoutes from './routes/bank-data-providers.route';
import betterAuthExtensionsRoutes from './routes/better-auth-extensions.route';
import billingRoutes from './routes/billing.route';
import brandLogosRoutes from './routes/brand-logos.route';
import budgetsRoutes from './routes/budgets.route';
import categoriesRoutes from './routes/categories.route';
import clientLogsRoutes from './routes/client-logs.route';
import modelsCurrenciesRoutes from './routes/currencies.route';
import demoRoutes from './routes/demo.route';
import exchangeRatesRoutes from './routes/exchange-rates';
import githubRoutes from './routes/github.route';
import aiMappingRoutes from './routes/import-export/ai-mapping.route';
import batchesRoutes from './routes/import-export/batches.route';
import budgetBakersWalletImportRoutes from './routes/import-export/budget-bakers-wallet.route';
import csvImportExportRoutes from './routes/import-export/csv.route';
import msMoneyImportRoutes from './routes/import-export/ms-money.route';
import ofxImportRoutes from './routes/import-export/ofx.route';
import statementParserRoutes from './routes/import-export/text-source.route';
import ynabImportRoutes from './routes/import-export/ynab.route';
import investmentsRoutes from './routes/investments.route';
import landingRoutes from './routes/landing.route';
import loansRoutes from './routes/loans.route';
import mcpRoutes from './routes/mcp.route';
import notificationsRoutes from './routes/notifications.route';
import { setupOAuthMetadataRoutes } from './routes/oauth-metadata.route';
import payeesRoutes from './routes/payees.route';
import resourceLeasesRoutes from './routes/resource-leases.route';
import shareRoutes from './routes/share.route';
import sseRoutes from './routes/sse.route';
import statsRoutes from './routes/stats.route';
import subscriptionsRoutes from './routes/subscriptions.route';
import tagRemindersRoutes from './routes/tag-reminders.route';
import tagsRoutes from './routes/tags.route';
import testsRoutes from './routes/tests.route';
import transactionAutomationsRoutes from './routes/transaction-automations.route';
import transactionGroupsRoutes from './routes/transaction-groups.route';
import transactionTemplatesRoutes from './routes/transaction-templates.route';
import transactionsRoutes from './routes/transactions.route';
import userRoutes from './routes/user.route';
import vehiclesRoutes from './routes/vehicles.route';
import ventureRoutes from './routes/venture.route';
import webhooksRoutes from './routes/webhooks.route';

export function setupRoutes(app: Express) {
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Better-auth extensions (wraps server-side only APIs like setPassword)
  // Must be mounted BEFORE better-auth handler to take precedence
  app.use(`${API_PREFIX}/auth`, betterAuthExtensionsRoutes);

  // Demo mode route - creates temporary demo users with seeded data
  // Rate limited to prevent abuse
  app.use(`${API_PREFIX}/demo`, demoRoutes);

  // Mount better-auth handler for all auth routes
  // This handles: signup, signin, signout, session, oauth callbacks, passkey, etc.
  // We wrap the handler to preserve AsyncLocalStorage context for locale-aware category creation
  const authHandler = toNodeHandler(auth);

  // Patch OAuth2 dynamic client registration requests so they always register as
  // public clients.  better-auth's oauth-provider treats clients without
  // `token_endpoint_auth_method: "none"` as confidential and rejects unauthenticated
  // registration with 401 – even when allowUnauthenticatedClientRegistration is true.
  // MCP clients (e.g. Claude.ai) often omit this field, so we default it here.
  //
  // We can't patch the stream in-place (Node 23's Fetch API reads the internal
  // buffer directly), so we proxy the request through a local HTTP call with the
  // modified body.
  app.post(`${API_PREFIX}/auth/oauth2/register`, (req: Request, res: Response, next) => {
    // Skip if already patched (avoid infinite loop on the proxied request)
    if (req.headers['x-register-patched']) return next();

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      let body: Buffer;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString());
        const isUnauthenticated = !req.headers.authorization && !req.headers.cookie;
        const isConfidential = parsed.token_endpoint_auth_method && parsed.token_endpoint_auth_method !== 'none';

        // Unauthenticated + confidential always fails in better-auth (401), so
        // downgrade to public client.  Authenticated registrations and requests
        // that are already public pass through unchanged.
        if (isUnauthenticated && isConfidential) {
          parsed.token_endpoint_auth_method = 'none';
        }
        body = Buffer.from(JSON.stringify(parsed));
      } catch {
        // Not valid JSON – proxy the original bytes and let better-auth error
        logger.info('[register-patch] Failed to parse request body as JSON');
        body = Buffer.concat(chunks);
      }

      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: Number(req.app.get('port')) || 8080,
          path: req.originalUrl,
          method: 'POST',
          headers: {
            ...req.headers,
            'content-length': body.length.toString(),
            'x-register-patched': '1',
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on('error', (err) => {
        logger.error({ message: '[register-patch] Proxy request failed', error: err });
        if (!res.headersSent) res.status(502).json({ error: 'registration proxy failed' });
      });
      proxyReq.write(body);
      proxyReq.end();
    });
    req.on('error', (err) => {
      logger.error({ message: '[register-patch] Request stream error', error: err });
      next();
    });
  });

  // Public endpoint for the consent page to resolve a client_id to a display name.
  // Must be registered before the app.all catch-all so better-auth doesn't swallow it.
  // oxlint-disable-next-line oxc/no-async-endpoint-handlers
  app.get(`${API_PREFIX}/auth/oauth2/client-info`, async (req: Request, res: Response) => {
    const clientId = req.query.client_id;
    if (!clientId || typeof clientId !== 'string') {
      res.status(400).json({ status: 'error', response: 'client_id is required' });
      return;
    }
    try {
      const result = await authPool.query<{ name: string | null }>(
        `SELECT "name" FROM "ba_oauth_client" WHERE "clientId" = $1 LIMIT 1`,
        [clientId],
      );
      res.json({ status: 'success', response: { name: result.rows[0]?.name ?? null } });
    } catch (e) {
      logger.error({
        message: '[client-info] Failed to look up client',
        error: e instanceof Error ? e : new Error(String(e)),
      });
      res.status(500).json({ status: 'error', response: 'Failed to look up client' });
    }
  });

  app.all(`${API_PREFIX}/auth/*`, (req: Request, res: Response) => {
    // Extract locale from Accept-Language header (same logic as detectLanguage middleware)
    const supportedLocales = SUPPORTED_LOCALES;
    const headerLang = req.headers['accept-language']?.split(',')[0]?.split('-')[0];
    const locale = headerLang && supportedLocales.includes(headerLang) ? headerLang : 'en';

    // Wrap the handler in AsyncLocalStorage context to ensure locale is available in hooks
    requestContext.run({ locale }, () => {
      authHandler(req, res);
    });
  });

  app.use(`${API_PREFIX}/user`, userRoutes);
  app.use(`${API_PREFIX}/accounts`, accountsRoutes);
  app.use(`${API_PREFIX}/transactions`, transactionsRoutes);
  app.use(`${API_PREFIX}/attachments`, attachmentsRoutes);
  app.use(`${API_PREFIX}/categories`, categoriesRoutes);
  app.use(`${API_PREFIX}/models/currencies`, modelsCurrenciesRoutes);
  app.use(`${API_PREFIX}/bank-data-providers`, bankDataProvidersRoutes);
  app.use(`${API_PREFIX}/stats`, statsRoutes);
  app.use(`${API_PREFIX}/account-group`, accountGroupsRoutes);
  app.use(`${API_PREFIX}/currencies/rates`, exchangeRatesRoutes);
  app.use(`${API_PREFIX}/budgets`, budgetsRoutes);
  app.use(`${API_PREFIX}/subscriptions`, subscriptionsRoutes);
  app.use(`${API_PREFIX}/tags`, tagsRoutes);
  app.use(`${API_PREFIX}/tag-reminders`, tagRemindersRoutes);
  app.use(`${API_PREFIX}/transaction-groups`, transactionGroupsRoutes);
  app.use(`${API_PREFIX}/automations`, transactionAutomationsRoutes);
  app.use(`${API_PREFIX}/transaction-templates`, transactionTemplatesRoutes);
  app.use(`${API_PREFIX}/notifications`, notificationsRoutes);
  app.use(`${API_PREFIX}/payees`, payeesRoutes);
  app.use(`${API_PREFIX}/brand-logos`, brandLogosRoutes);
  app.use(`${API_PREFIX}/vehicles`, vehiclesRoutes);
  app.use(`${API_PREFIX}/loans`, loansRoutes);
  app.use(`${API_PREFIX}/share`, shareRoutes);
  app.use(`${API_PREFIX}/investments`, investmentsRoutes);
  app.use(`${API_PREFIX}/venture`, ventureRoutes);
  app.use('/mcp', mcpRoutes);
  app.use(`${API_PREFIX}/import`, csvImportExportRoutes);
  app.use(`${API_PREFIX}/import`, statementParserRoutes);
  app.use(`${API_PREFIX}/import`, ynabImportRoutes);
  app.use(`${API_PREFIX}/import`, budgetBakersWalletImportRoutes);
  app.use(`${API_PREFIX}/import`, msMoneyImportRoutes);
  app.use(`${API_PREFIX}/import`, ofxImportRoutes);
  app.use(`${API_PREFIX}/import`, batchesRoutes);
  app.use(`${API_PREFIX}/import`, aiMappingRoutes);
  app.use(`${API_PREFIX}/resource-leases`, resourceLeasesRoutes);
  app.use(`${API_PREFIX}/client-logs`, clientLogsRoutes);
  app.use(`${API_PREFIX}/sse`, sseRoutes);
  app.use(`${API_PREFIX}/webhooks`, webhooksRoutes);
  app.use(`${API_PREFIX}/github`, githubRoutes);
  app.use(`${API_PREFIX}/landing`, landingRoutes);
  app.use(`${API_PREFIX}/billing`, billingRoutes);
  app.use(`${API_PREFIX}/admin`, adminRoutes);

  // "development" is required here: Playwright frontend e2e tests run against
  // the dev backend on CI and rely on /tests/verify-email and other test-only endpoints.
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
    app.use(`${API_PREFIX}/tests`, testsRoutes);
  }

  setupOAuthMetadataRoutes({ app });

  // Block search engine crawling on the API subdomain
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /');
  });

  // RFC 9116 – security disclosure contact. Served on api.moneymatter.app and
  // mcp.moneymatter.app; the SPA host has a static mirror in nginx.
  // Refresh `Expires` before it lapses, otherwise scanners flag it as expired.
  const securityTxt = [
    'Contact: https://github.com/letehaha/moneymatter/security/advisories/new',
    'Expires: 2027-04-25T00:00:00.000Z',
    'Preferred-Languages: en',
    'Canonical: https://api.moneymatter.app/.well-known/security.txt',
    '',
  ].join('\n');
  const serveSecurityTxt = (_req: Request, res: Response) => {
    res.type('text/plain').send(securityTxt);
  };
  app.get('/.well-known/security.txt', serveSecurityTxt);
  app.get('/security.txt', serveSecurityTxt);

  // Sentry error handler - must be after routes but before other error handlers
  // Only set up in production when Sentry is actually initialized
  if (process.env.NODE_ENV === 'production') {
    Sentry.setupExpressErrorHandler(app);
  }
}

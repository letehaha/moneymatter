import { API_ERROR_CODES, RESOURCE_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { app } from '@root/app';
import { redisClient } from '@root/redis-client';
import { buildLockKey } from '@services/currencies/base-currency-lock';
import * as helpers from '@tests/helpers';
import { ErrorResponse } from '@tests/helpers/common';

const AUTH_MIDDLEWARE = 'authenticateSession';
const GUARD_MIDDLEWARE = 'checkBaseCurrencyLock';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOCK_CODE = API_ERROR_CODES.baseCurrencyChangeInProgress;
const OTHER_USER_LOCK_CODE = API_ERROR_CODES.baseCurrencyChangeInProgressOtherUser;

/** Hold the user's base-currency lock for the duration of `fn`, then release it. */
async function withUserLock<T>({ userId, fn }: { userId: number; fn: () => Promise<T> }): Promise<T> {
  await redisClient.set(buildLockKey(userId), 'test-lock');
  try {
    return await fn();
  } finally {
    await redisClient.del(buildLockKey(userId));
  }
}

/**
 * Routes that are authenticated (`authenticateSession`) and mutating yet intentionally
 * run WITHOUT `checkBaseCurrencyLock`. Everything else in that category must carry the
 * guard — the invariant test below fails when a new route slips through. Keep sorted
 * within each group; the `${METHOD} ${fullPath}` key must match the reconstructed path.
 */
const GUARD_EXEMPT_ROUTES = new Set<string>([
  // The enqueue route: its NX lock acquisition is its own dedupe and returns the 423.
  'POST /api/v1/user/currencies/change-base',

  // better-auth extensions — account credential management, no monetary data.
  'POST /api/v1/auth/set-password',

  // Notifications read-marking — high-frequency, non-monetary state.
  'POST /api/v1/notifications/read-all',
  'POST /api/v1/notifications/:id/read',

  // Billing and admin plan grants: Stripe sessions and plan flags, no monetary data.
  'PATCH /api/v1/admin/users/:id/plan',
  'POST /api/v1/billing/checkout',
  'POST /api/v1/billing/portal',

  // Lease extension writes no financial data, and refusing it mid-wizard would
  // drop the user's upload for nothing.
  'POST /api/v1/resource-leases/refresh',

  // Client diagnostics only reach the log stream, and they must keep flowing
  // while a migration holds the lock.
  'POST /api/v1/client-logs',

  // User profile / settings / AI settings / data-export — authenticated but touch no
  // monetary data; blocking them for the duration of a migration is user-hostile.
  'DELETE /api/v1/user/settings/ai/connections/:id',
  'DELETE /api/v1/user/settings/ai/features/:feature',
  'DELETE /api/v1/user/settings/mcp/connected-apps/:clientId',
  'PATCH /api/v1/user/settings',
  'POST /api/v1/user/backup',
  'POST /api/v1/user/data-export',
  'POST /api/v1/user/feature-trials/:feature',
  'POST /api/v1/user/settings/ai/connections',
  'POST /api/v1/user/settings/ai/connections/:id/default',
  'POST /api/v1/user/settings/ai/connections/models',
  'POST /api/v1/user/settings/ai/connections/test',
  'PUT /api/v1/user/settings',
  'PUT /api/v1/user/settings/ai/connections/:id',
  'PUT /api/v1/user/settings/ai/custom-instructions',
  'PUT /api/v1/user/settings/ai/features/:feature',
  'PUT /api/v1/user/settings/onboarding',
  'PUT /api/v1/user/update',

  // Invoice matching only ranks candidates; the one write is the non-monetary trial counter.
  'POST /api/v1/transactions/match-invoice',
  'POST /api/v1/transactions/match-invoice/candidates',

  // AI categorization writes categoryId/categorizationMeta only, never ref amounts,
  // so a base-currency migration and a run cannot corrupt each other.
  'POST /api/v1/user/ai/categorization/trigger',

  // Attachments are files on a transaction; they touch no amounts.
  'DELETE /api/v1/attachments/:id',
  'POST /api/v1/transactions/:transactionId/attachments',
  'POST /api/v1/tests/attachment-upload-token',

  // AI suggestion call — reads nothing monetary, writes nothing.
  'POST /api/v1/import/ai-map-categories',

  // Admin-only investment price maintenance — these write GLOBAL SecurityPricing
  // reference data, not any user's ref amounts, so a per-user base-currency
  // migration has no bearing on them.
  'POST /api/v1/investments/securities/price-upload-info',
  'POST /api/v1/investments/securities/prices/bulk-upload',
  'POST /api/v1/investments/sync/securities-prices',
]);

interface DiscoveredRoute {
  method: string;
  path: string;
  middlewares: string[];
}

/**
 * Reconstruct a router's mount prefix from the Express 4 mount `layer.regexp`. Mount
 * paths here are all static literals, so the leading run of path characters after the
 * `^` anchor is the prefix; the trailing optional-slash + lookahead the router adds is
 * dropped by cutting at the first non-path character.
 */
function mountPrefixFromRegexp(layer: { regexp?: RegExp & { fast_slash?: boolean } }): string {
  const regexp = layer.regexp;
  if (!regexp || regexp.fast_slash) return '';

  const unescaped = regexp.source.replace(/^\^/, '').replace(/\\\//g, '/').replace(/\\\./g, '.');
  const match = unescaped.match(/^[/\w.-]+/);
  let prefix = match ? match[0] : '';
  if (prefix.length > 1 && prefix.endsWith('/')) prefix = prefix.slice(0, -1);
  return prefix;
}

/**
 * Walk the Express app router stack and return every concrete route with the ordered
 * names of the middlewares mounted on it. Only router layers (`app.use(prefix, router)`)
 * are traversed; app-level handlers (health, auth proxies, `.well-known`) carry no
 * `authenticateSession` and are irrelevant to the guard invariant.
 */
function collectRoutes(): DiscoveredRoute[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appRouter = (app as any)._router ?? (app as any).router;
  if (!appRouter?.stack) {
    throw new Error('Express app router stack not available — cannot verify guard coverage');
  }

  const routes: DiscoveredRoute[] = [];

  for (const appLayer of appRouter.stack) {
    if (appLayer.name !== 'router' || !appLayer.handle?.stack) continue;
    const prefix = mountPrefixFromRegexp(appLayer);

    // Router-level middleware (`router.use(fn)`) shares this stack with the routes
    // but carries no `.route`. Auth mounted that way (investments, venture) never
    // lands on an individual route's own stack, so accumulate the named blanket
    // layers as we walk and prepend them to every route that follows. Every real
    // usage is pathless, so no path gating is needed.
    const routerMiddlewares: string[] = [];

    for (const routeLayer of appLayer.handle.stack) {
      const route = routeLayer.route;
      if (!route) {
        if (routeLayer.name && routeLayer.name !== '<anonymous>') {
          routerMiddlewares.push(routeLayer.name);
        }
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const middlewares: string[] = [...routerMiddlewares, ...route.stack.map((entry: any) => entry.name)];
      const routePaths = Array.isArray(route.path) ? route.path : [route.path];
      const methods = Object.keys(route.methods)
        .filter((method) => route.methods[method] && method !== '_all')
        .map((method) => method.toUpperCase());

      for (const routePath of routePaths) {
        for (const method of methods) {
          let full = `${prefix}${routePath}`.replace(/\/{2,}/g, '/');
          if (full.length > 1 && full.endsWith('/')) full = full.slice(0, -1);
          routes.push({ method, path: full, middlewares });
        }
      }
    }
  }

  return routes;
}

describe('Base-currency guard coverage', () => {
  it('detects auth + guard middleware by name on a known route (sanity)', () => {
    const routes = collectRoutes();
    // A large stack is expected; a near-empty result means the walk broke and every
    // assertion below would pass vacuously.
    expect(routes.length).toBeGreaterThan(50);

    const createTransaction = routes.find((route) => route.method === 'POST' && route.path === '/api/v1/transactions');
    expect(createTransaction).toBeDefined();
    expect(createTransaction!.middlewares).toContain(AUTH_MIDDLEWARE);
    expect(createTransaction!.middlewares).toContain(GUARD_MIDDLEWARE);
  });

  it('guards every authenticated mutating route (or allowlists it)', () => {
    const offenders = collectRoutes()
      .filter((route) => MUTATING_METHODS.has(route.method))
      .filter((route) => route.middlewares.includes(AUTH_MIDDLEWARE))
      .filter((route) => !route.middlewares.includes(GUARD_MIDDLEWARE))
      .map((route) => `${route.method} ${route.path}`)
      .filter((key) => !GUARD_EXEMPT_ROUTES.has(key))
      .sort();

    const message = offenders.length
      ? `Found ${offenders.length} authenticated mutating route(s) missing checkBaseCurrencyLock ` +
        `(add the guard, or allowlist in GUARD_EXEMPT_ROUTES if genuinely non-monetary):\n  ${offenders.join('\n  ')}`
      : '';

    expect(message).toBe('');
  });

  it('never lets checkBaseCurrencyLock land on a GET route', () => {
    // A GET carrying the guard is a deadlock: a locked client polling GET
    // /user/currencies/change-base/status would get 423 and never see the
    // change finish, so the overlay that reads it could never unblock.
    const offenders = collectRoutes()
      .filter((route) => route.method === 'GET')
      .filter((route) => route.middlewares.includes(GUARD_MIDDLEWARE))
      .map((route) => `${route.method} ${route.path}`)
      .sort();

    expect(offenders).toEqual([]);
  });
});

describe('Base-currency lock returns 423 on guarded routes', () => {
  function expectLocked(response: { statusCode: number; body: { response: unknown } }) {
    expect(response.statusCode).toBe(ERROR_CODES.Locked);
    expect((response.body.response as ErrorResponse).code).toBe(LOCK_CODE);
  }

  it('blocks PUT /user/currency/rates, POST /import/csv/execute, POST /accounts/:id/balance-adjustment and POST /categories', async () => {
    // The account has to exist before the lock is taken: POST /accounts is guarded too.
    const account = await helpers.createAccount({ raw: true });

    await withUserLock({
      userId: account.userId,
      fn: async () => {
        expectLocked(await helpers.makeRequest({ method: 'put', url: '/user/currency/rates', payload: { pairs: [] } }));
        expectLocked(await helpers.makeRequest({ method: 'post', url: '/import/csv/execute', payload: { rows: [] } }));
        expectLocked(
          await helpers.makeRequest({
            method: 'post',
            url: `/accounts/${account.id}/balance-adjustment`,
            payload: { amount: 100 },
          }),
        );
        expectLocked(
          await helpers.makeRequest({ method: 'post', url: '/categories', payload: { name: 'Blocked category' } }),
        );
      },
    });
  });

  it('still serves GET /user/currencies/change-base/status while locked (200, not 423)', async () => {
    // The overlay polls this endpoint to learn the change finished; if the lock
    // blocked it, a locked client could never observe the unblock.
    const user = await helpers.getUserInfo({ raw: true });
    const response = await withUserLock({
      userId: user.id,
      fn: () => helpers.getBaseCurrencyChangeStatus({ raw: false }),
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('Share-accept refuses while either party holds the base-currency lock', () => {
  async function setUpPendingAccountShare() {
    const owner = await helpers.getUserInfo({ raw: true });
    const account = await helpers.createAccount({ raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });

    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.account,
      resourceId: account.id,
      permission: SHARE_PERMISSIONS.read,
      raw: true,
    });

    return { ownerId: owner.id, recipient, recipientId: recipientApp.id, token: invitation.token };
  }

  it('returns 423 with the other-party code when the resource owner is locked', async () => {
    const { ownerId, recipient, token } = await setUpPendingAccountShare();

    const response = await withUserLock({
      userId: ownerId,
      fn: () =>
        helpers.asUser({
          cookies: recipient.cookies,
          fn: () => helpers.acceptShareInvitation({ token }),
        }),
    });
    expect(response.statusCode).toBe(ERROR_CODES.Locked);
    // The acceptor themselves is not migrating, so this must NOT be the app-blocking
    // own-lock code — the other party's migration should not freeze their whole app.
    expect((response.body.response as unknown as ErrorResponse).code).toBe(OTHER_USER_LOCK_CODE);
  });

  it('returns 423 when the acceptor is locked', async () => {
    const { recipient, recipientId, token } = await setUpPendingAccountShare();

    const response = await withUserLock({
      userId: recipientId,
      fn: () =>
        helpers.asUser({
          cookies: recipient.cookies,
          fn: () => helpers.acceptShareInvitation({ token }),
        }),
    });
    expect(response.statusCode).toBe(ERROR_CODES.Locked);
    expect((response.body.response as unknown as ErrorResponse).code).toBe(LOCK_CODE);
  });
});

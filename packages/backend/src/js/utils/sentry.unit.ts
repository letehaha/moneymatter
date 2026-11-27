import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@sentry/node', () => ({}));

// eslint-disable-next-line import/first
import {
  IGNORED_SPAN_PATTERNS,
  isBankProviderRequest,
  isUntracedPollingTransaction,
  resolveTracesSampleRate,
} from './sentry';

// Mirrors the SDK's `ignoreSpans` matching for RegExp patterns: `pattern.test(description)`.
const isIgnored = (description: string) => IGNORED_SPAN_PATTERNS.some((pattern) => pattern.test(description));

describe('resolveTracesSampleRate', () => {
  it.each([
    [undefined, 0.01],
    ['', 0.01],
    ['abc', 0.01],
    ['0', 0.01],
    ['-1', 0.01],
    ['0.05', 0.05],
    ['0.2', 0.2],
    ['0.5', 0.2],
    ['1', 0.2],
    ['100', 0.2],
  ])('maps %p to %p', (raw, expected) => {
    expect(resolveTracesSampleRate({ raw })).toBe(expected);
  });
});

describe('isUntracedPollingTransaction', () => {
  it.each([
    'GET /api/v1/sse/events',
    'GET /api/v1/notifications/unread-count',
    'GET /api/v1/bank-data-providers/sync/status',
    'GET /api/v1/user/ai/categorization/status',
    'GET /api/v1/user/backup/restore/status',
    'GET /api/v1/user/currencies/change-base/status',
    'GET /api/v1/import/batch-delete/status',
    'GET https://api.moneymatter.app/api/v1/notifications/unread-count',
    'GET /api/v1/sse/events/',
  ])('does not trace %p', (name) => {
    expect(isUntracedPollingTransaction({ name })).toBe(true);
  });

  it.each([
    'POST /mcp',
    'GET /mcp',
    'GET /api/v1/notifications',
    'GET /api/v1/transactions',
    'GET /api/v1/transactions/transfer/123',
    'GET /api/v1/accounts',
    'GET /api/v1/venture/deals/7/metrics',
    'GET /api/v1/import/csv/status',
    'POST /api/v1/user/ai/categorization/trigger',
    'POST /api/v1/notifications/unread-count',
    'GET /api/v1/auth/get-session',
    'queue_consumer:account-sync',
  ])('keeps %p sampled', (name) => {
    expect(isUntracedPollingTransaction({ name })).toBe(false);
  });
});

describe('IGNORED_SPAN_PATTERNS', () => {
  it.each([
    'GET /get-session',
    'handler /get-session',
    'hook after /get-session plugin:jwt',
    'db findMany ba_jwks',
    'db findOne ba_session',
    'db findOne ba_user',
    'select * from "ba_jwks" limit $1',
    'select * from "ba_session" where "token" = $1 limit $2',
    'select * from "ba_user" where "id" = $1 limit $2',
    'START TRANSACTION;',
    'COMMIT;',
    "SET client_min_messages TO warning;SET TIME ZONE INTERVAL '+00:00' HOUR TO MINUTE",
  ])('drops %p', (description) => {
    expect(isIgnored(description)).toBe(true);
  });

  it.each([
    'GET /api/v1/transactions',
    'GET /api/v1/auth/get-session',
    'GET /api/v1/sse/events',
    'POST /mcp',
    'queue_consumer:account-sync',
    'ROLLBACK;',
    'START TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
    'SELECT "id" FROM "Accounts" AS "Accounts" WHERE "Accounts"."userId" = 3694;',
    'SELECT "resourceId" FROM "ResourceShares" AS "ResourceShares" WHERE "ResourceShares"."userId" = 1;',
    'pg.connect',
    'POST /sign-in/email',
    'handler /sign-in/email',
    'hook before /sign-in/email plugin:passkey',
    'POST /oauth2/token',
    'handler /oauth2/token',
    'POST /passkey/verify-authentication',
    'GET /list-accounts',
    'POST /sign-out',
    'onRequest oauth-provider',
    'db findOne ba_oauth_access_token',
    'db findMany ba_account',
    'db create ba_session',
    'db delete ba_session',
    'select * from "ba_oauth_access_token" where "token" = $1 limit $2',
    'select * from "ba_account" where "userId" = $1',
    'insert into "ba_session" ("id", "token") values ($1, $2) returning *',
    'delete from "ba_session" where "token" = $1',
    'update "ba_user" set "name" = $1 where "id" = $2',
  ])('keeps %p', (description) => {
    expect(isIgnored(description)).toBe(false);
  });
});

describe('isBankProviderRequest', () => {
  it.each([
    '/api/v1/bank-data-providers/plaid/connect',
    '/api/v1/bank-data-providers/akahu/connect?x=1',
    '/API/V1/Bank-Data-Providers/lunchflow/connect/',
    '/api/v1/bank-data-providers/connections/abc/reauthorize',
    '/api/v1/bank-data-providers/enablebanking/banks',
    'https://api.example.com/api/v1/bank-data-providers/connections/abc',
  ])('drops the body of %p', (url) => {
    expect(isBankProviderRequest(url)).toBe(true);
  });

  it.each(['/api/v1/transactions', '/api/v1/bank-data-providers-other', '/bank-data-providers/plaid/connect'])(
    'keeps the body of %p',
    (url) => {
      expect(isBankProviderRequest(url)).toBe(false);
    },
  );
});

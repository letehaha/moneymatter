/* eslint-disable @typescript-eslint/no-explicit-any */
import type { RecordId } from '@bt/shared/types';
import { until } from '@common/helpers';
import { invalidateCurrencyDecimalsCache } from '@common/lib/currency-decimals-cache';
import { roundHalfToEven } from '@common/utils/round-half-to-even';
import { i18nextReady } from '@i18n/index';
import { afterAll, afterEach, beforeAll, beforeEach, expect, jest } from '@jest/globals';
import Categories from '@models/categories.model';
import { connection } from '@models/index';
import UsersModel from '@models/users.model';
import { serverInstance } from '@root/app';
import { loadCurrencyRatesJob } from '@root/crons/exchange-rates';
import { REDIS_KEY_PREFIX, redisClient, redisReady } from '@root/redis-client';
import { categorizationQueue, categorizationWorker } from '@services/ai-categorization/categorization-queue';
import { flushAllPendingCategorizationBuffers } from '@services/ai-categorization/event-listeners';
import { backupRestoreQueue, backupRestoreWorker } from '@services/backup/restore/restore-queue';
import { closeAllMonobankQueueBundles } from '@services/bank-data-providers/monobank/transaction-sync-queue';
import { accountSyncQueue, accountSyncWorker } from '@services/bank-data-providers/sync/account-sync-queue';
import { logoResolutionQueue, logoResolutionWorker } from '@services/brand-logos';
import { chatTailHub } from '@services/chat/runs/tail-hub';
import { baseCurrencyChangeQueue, baseCurrencyChangeWorker } from '@services/currencies/base-currency-change-queue';
import {
  budgetBakersWalletImportQueue,
  budgetBakersWalletImportWorker,
} from '@services/import-export/budget-bakers-wallet-import';
import { csvImportQueue, csvImportWorker } from '@services/import-export/csv-import/csv-import-queue';
import { importBatchDeleteQueue, importBatchDeleteWorker } from '@services/import-export/delete-batch-queue';
import { msMoneyImportQueue, msMoneyImportWorker } from '@services/import-export/ms-money-import';
import { ofxImportQueue, ofxImportWorker } from '@services/import-export/ofx-import';
import {
  statementImportQueue,
  statementImportWorker,
} from '@services/import-export/statement-parser/statement-import-queue';
import { ynabImportQueue, ynabImportWorker } from '@services/import-export/ynab-import';
import {
  subscriptionReminderEmailQueue,
  subscriptionReminderEmailWorker,
} from '@services/subscriptions/reminder-email-queue';
import { trackerScanQueue, trackerScanWorker } from '@services/trackers/smart-tracking/tracker-scan-queue';
import { createAppUserWithUniqueUsername, seedUserDefaults } from '@services/user/create-user-with-defaults.service';
import { STRIPE_TEST_WEBHOOK_SECRET, extractCookies, makeAuthRequest, makeRequest } from '@tests/helpers';
import { startOfDay } from 'date-fns';

import { resetSessionCounter } from './mocks/enablebanking/mock-api';
import { setupMswServer } from './mocks/setup-mock-server';
import { retryWithBackoff } from './utils/retry-db-operation-with-backoff';

const mswMockServer = setupMswServer();

// Mock the entire module globally. Mocked implementation will be per-test
jest.mock('@polygon.io/client-js', () => ({
  restClient: jest.fn().mockReturnValue({
    reference: {
      tickers: jest.fn(),
      exchanges: jest.fn(),
    },
    stocks: {
      aggregatesGroupedDaily: jest.fn(),
      aggregates: jest.fn(),
    },
  }),
}));

jest.mock('alphavantage', () =>
  jest.fn().mockReturnValue({
    data: {
      search: jest.fn(),
      quote: jest.fn(),
      daily: jest.fn(),
    },
  }),
);

// Mock the FMP client globally
jest.mock('../services/investments/data-providers/clients/fmp-client', () => ({
  FmpClient: jest.fn().mockImplementation(() => ({
    search: jest.fn(),
    getQuote: jest.fn(),
    getHistoricalPrices: jest.fn(),
    getHistoricalPricesFull: jest.fn(),
  })),
}));

// Mock yahoo-finance2 globally (v3 requires instantiation).
// All methods reject by default so the composite provider falls back to other
// providers (FMP, Polygon, etc.) in existing tests. Tests that specifically
// exercise Yahoo behaviour must override these mocks per-test.
jest.mock('yahoo-finance2', () => {
  const MockYahooFinance = jest.fn().mockImplementation(() => ({
    search: jest.fn<any>().mockRejectedValue(new Error('Yahoo mock: not configured for test')),
    quote: jest.fn<any>().mockRejectedValue(new Error('Yahoo mock: not configured for test')),
    chart: jest.fn<any>().mockRejectedValue(new Error('Yahoo mock: not configured for test')),
  }));
  return { __esModule: true, default: MockYahooFinance };
});

// Mock the official CoinGecko TypeScript SDK globally. The composite provider
// fans out to CoinGecko on every search, so without this mock every search
// e2e test would either hit the live API or fail. Methods are no-ops by
// default (empty results); crypto-specific tests override them per-suite.
jest.mock('@coingecko/coingecko-typescript', () => {
  const MockCoingecko = jest.fn().mockImplementation(() => ({
    search: {
      get: jest.fn<any>().mockResolvedValue({ coins: [] }),
    },
    simple: {
      price: {
        get: jest.fn<any>().mockResolvedValue({}),
      },
    },
    coins: {
      marketChart: {
        get: jest.fn<any>().mockResolvedValue({ prices: [] }),
        getRange: jest.fn<any>().mockResolvedValue({ prices: [] }),
      },
    },
  }));
  return { __esModule: true, default: MockCoingecko };
});

/**
 * Guard against stale local `.env.test`. The data-provider factory only
 * registers a provider when its API key is present in `process.env`, so a
 * missing key silently turns the corresponding provider into a no-op and any
 * test that expects results from it fails with a misleading "empty array"
 * assertion – costing hours to diagnose.
 *
 * CI generates a fresh `.env.test` from `check-source-code.yml`; local files
 * are gitignored and easily drift. We fail loud here so the fix is obvious.
 */
const REQUIRED_TEST_ENV_VARS = [
  'FMP_API_KEY',
  'POLYGON_API_KEY',
  'ALPHA_VANTAGE_API_KEY',
  'COINGECKO_API_KEY',
] as const;

const missingEnvVars = REQUIRED_TEST_ENV_VARS.filter((key) => !process.env[key]);
if (missingEnvVars.length > 0) {
  throw new Error(
    `Missing required test env vars: ${missingEnvVars.join(', ')}. ` +
      `Add them to <repo-root>/.env.test (any non-empty value, e.g. "test"). ` +
      `CI sets these automatically via .github/workflows/check-source-code.yml.`,
  );
}

/**
 * logo.dev brand search is always MSW-mocked in tests, so a real key is never
 * needed – but `searchBrands` short-circuits to [] when LOGO_DEV_SECRET_KEY is
 * unset, before reaching the fetch() that MSW intercepts. Default a dummy value
 * so the request reaches the mock. Unlike the real-provider keys above, there's
 * no stale-.env.test failure mode to guard against, so we default rather than
 * fail loud.
 */
process.env.LOGO_DEV_SECRET_KEY = process.env.LOGO_DEV_SECRET_KEY || 'test';

/** Price-id map the billing fixtures and webhook mapping are written against. */
process.env.STRIPE_ENV = 'test';
process.env.STRIPE_WEBHOOK_SECRET ??= STRIPE_TEST_WEBHOOK_SECRET;
/** Matches the config default, so the Stripe client's "returns buyers to localhost" guard passes. */
process.env.AUTH_ORIGIN ??= 'https://localhost:8100';

/**
 * On CI, retry a failed test in-process before failing the run. A single flaky
 * test otherwise fails the whole jest run, and the workflow-level retry loop in
 * check-source-code.yml re-runs the entire shard, Docker boot included (~+7 min).
 * Retries are safe here: jest-circus re-runs beforeEach/afterEach around each
 * retry, so `truncateAllTables()` gives the retried test a clean DB.
 * `logErrorsBeforeRetry` prints the original failure, keeping flakes visible in
 * CI logs. `CI` reaches the test-runner container via the env passthrough in
 * docker/test/backend/docker-compose.yml.
 */
if (process.env.CI) {
  jest.retryTimes(2, { logErrorsBeforeRetry: true });
}

beforeAll(async () => {
  mswMockServer.listen({ onUnhandledRequest: 'bypass' });
  // Wait for i18next to fully load all locale files before tests run
  await i18nextReady;
}, 30_000);
afterEach(() => {
  mswMockServer.resetHandlers();
  // Reset Enable Banking session counter to ensure test isolation
  // The counter persists across tests and affects mock responses for reconnection testing
  resetSessionCounter();
});
afterAll(() => mswMockServer.close());

global.mswMockServer = mswMockServer;

global.BASE_CURRENCY = null;
// Should be non-USD so that some tests make sense
global.BASE_CURRENCY_CODE = 'AED';
global.MODELS_CURRENCIES = null;
global.APP_AUTH_COOKIES = null;

/**
 * Tables that contain seed/reference data from migrations and should NOT be truncated.
 * These tables are populated during migration and their data is required for the app to function.
 * Use lowercase for comparison since pg_tables stores names in lowercase.
 */
const SEED_DATA_TABLES = [
  'sequelizemeta', // Migration tracking (SequelizeMeta)
  'currencies', // All world currencies - seeded in migration
  'merchantcategorycodes', // MCC codes - seeded in migration
  'exchangerates', // Exchange rates - seeded with historical rates (10 days ago)
];

/**
 * Fast table truncation - much faster than DROP + migrations
 * Uses TRUNCATE with CASCADE to clear all data while keeping schema intact
 */
async function truncateAllTables() {
  // Get all table names from the database (excluding system/seed tables and backup tables)
  // Use LOWER() for case-insensitive comparison since pg_tables stores names in lowercase
  const excludeList = SEED_DATA_TABLES.map((t) => `'${t}'`).join(', ');
  const [tables] = await connection.sequelize.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND LOWER(tablename) NOT IN (${excludeList})
    AND tablename NOT LIKE '%_backup_%'
  `);

  if (tables.length === 0) return;

  const tableNames = tables.map((t: { tablename: string }) => `"${t.tablename}"`).join(', ');

  // TRUNCATE all tables in a single statement with CASCADE
  // RESTART IDENTITY resets auto-increment counters
  // Use retry logic to handle potential deadlocks with parallel workers
  await retryWithBackoff(
    async () => {
      await connection.sequelize.query(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`);
    },
    15,
    200,
  );
}

async function waitForDatabaseConnection() {
  await until(
    async () => {
      try {
        await connection.sequelize.authenticate();
        return true;
      } catch {
        return false;
      }
    },
    { timeout: 10000, interval: 100 },
  );
}

async function waitForRedisConnection() {
  // Wait for Redis to be fully initialized (connected + cleanup done)
  // This uses the redisReady promise from redis-client.ts which ensures
  // clearAllSyncStatuses() has completed before proceeding
  try {
    await redisReady;
  } catch {
    // Redis might have failed to connect initially, try to poll for connection
  }

  // Poll until Redis is ready and responsive
  await until(
    async () => {
      try {
        // Check if client is connected and responsive
        if (redisClient.status !== 'ready') {
          return false;
        }
        const result = await redisClient.ping();
        return result === 'PONG';
      } catch {
        return false;
      }
    },
    { timeout: 15000, interval: 100 },
  );
}

expect.extend({
  toBeAnythingOrNull(received) {
    if (received !== undefined) {
      return {
        message: () => `expected ${received} to be anything or null`,
        pass: true,
      };
    }
    return {
      message: () => `expected ${received} not to be undefined`,
      pass: false,
    };
  },
  toBeWithinRange(received: number, target: number, range: number) {
    const pass = Math.abs(received - target) <= range;
    return {
      pass,
      message: () => `expected ${received} to be within ${range} of ${target}`,
    };
  },
  /**
   * Custom matcher for ref values (refAmount, refInitialBalance, refCurrentBalance, etc.)
   * Applies roundHalfToEven to the expected value and allows ±1 tolerance for floating point precision.
   * Use this matcher exclusively for ref* field comparisons involving currency rate calculations.
   */
  toEqualRefValue(received: number, expected: number) {
    const roundedExpected = roundHalfToEven(expected);
    const pass = Math.abs(received - roundedExpected) <= 1;
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to equal ref value ${roundedExpected} (±1)`
          : `expected ${received} to equal ref value ${roundedExpected} (±1), difference: ${Math.abs(received - roundedExpected)}`,
    };
  },
  toBeNumericEqual(received, expected) {
    const pass = Number(received) === Number(expected);
    if (pass) {
      return {
        message: () => `expected ${received} not to be numerically equal to ${expected}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be numerically equal to ${expected}`,
        pass: false,
      };
    }
  },
  toBeAfter(received: Date, expected: Date) {
    const pass = received > expected;
    return {
      pass,
      message: () => `expected ${received} to be after ${expected}`,
    };
  },
  toBeBefore(received: Date, expected: Date) {
    const pass = received < expected;
    return {
      pass,
      message: () => `expected ${received} to be before ${expected}`,
    };
  },
});

beforeEach(async () => {
  try {
    // Wait for both database and Redis connections with better error handling
    await Promise.all([waitForDatabaseConnection(), waitForRedisConnection()]);

    // Clean up Redis keys for this worker
    // With ioredis keyPrefix, keys('*') returns full keys including prefix
    // We need to strip the prefix before del() to avoid double-prefixing
    const workerKeys = await redisClient.keys('*');
    if (workerKeys.length) {
      const keysWithoutPrefix = REDIS_KEY_PREFIX
        ? workerKeys.map((k) => k.slice(REDIS_KEY_PREFIX!.length))
        : workerKeys;
      await redisClient.del(...keysWithoutPrefix);
    }

    // Schema comes from template database (created in setup-e2e-tests.sh).
    // We just need to truncate data between tests.
    await truncateAllTables();

    // Currencies is a seed table, so custom currencies created by a test outlive the truncation above.
    // Every table that could reference them is empty by now, so they can go.
    await connection.sequelize.query(`DELETE FROM "Currencies" WHERE "isCustom" = true`);
    invalidateCurrencyDecimalsCache();

    // ExchangeRates is preserved across tests (it's in SEED_DATA_TABLES) so the
    // historical seed survives, but that also means today-dated rows written by
    // an earlier test's on-demand provider fetch linger in the shared worker DB.
    // A later test that expects to fetch today's rate fresh from the mocked
    // provider would instead read that stale row (or fall back to the 10-day-old
    // seed), making its conversion non-deterministic. Drop today+future rows so
    // every test starts from only the historical seed and re-fetches today.
    await connection.sequelize.query(`DELETE FROM "ExchangeRates" WHERE date >= :today`, {
      replacements: { today: startOfDay(new Date()) },
    });

    // Set up test user for authentication
    // The better-auth mock returns a user with id 'test-user-id', so we need
    // to create a corresponding user in the database with that authUserId.
    const testEmail = 'test1@test.local';
    const testPassword = 'testpassword123';

    // Create the app user with default categories.
    // Pass 'en' locale explicitly since tests run without AsyncLocalStorage context.
    // authUserId must match what the better-auth mock returns.
    const seedAppUser = await createAppUserWithUniqueUsername({
      username: 'test1',
      authUserId: 'test-user-id',
      email: testEmail,
    });
    await seedUserDefaults({ userId: seedAppUser.id, locale: 'en' });

    // The suite's default user sits on the legacy (pre-trial) entitlement path, which
    // grants every plus feature. A trial would strip backup/export from most suites.
    await UsersModel.update({ trialEndsAt: null }, { where: { id: seedAppUser.id } });

    // Stash a default category UUID for helpers that build transaction payloads.
    // Pre-UUID-migration this was hardcoded to `categoryId: 1`; now we resolve
    // the first seeded main category dynamically so non-transfer tx requests pass
    // schema validation without each test plumbing categoryId explicitly.
    const defaultCategory = await Categories.findOne({
      where: { userId: seedAppUser.id, parentId: null },
      attributes: ['id'],
      raw: true,
    });
    if (!defaultCategory) {
      throw new Error('Setup: expected at least one seeded default category for test user');
    }
    global.DEFAULT_CATEGORY_ID = defaultCategory.id as RecordId;

    // Create better-auth records (ba_*) for test user
    // Since auth is mocked via MSW, we need to manually create these records
    // so that cascade deletion tests work correctly and we can execute tests
    // related to ba_* tables
    const authUserId = 'test-user-id';
    await connection.sequelize.query(
      `INSERT INTO ba_user (id, name, email, "emailVerified", image, "createdAt", "updatedAt")
       VALUES (:id, 'Test User', :email, true, NULL, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      { replacements: { id: authUserId, email: testEmail } },
    );
    await connection.sequelize.query(
      `INSERT INTO ba_account (id, "userId", "accountId", "providerId", "accessToken", "refreshToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", scope, "idToken", password, "createdAt", "updatedAt")
       VALUES (:id, :userId, :accountId, 'credential', NULL, NULL, NULL, NULL, NULL, NULL, 'hashed_password', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      { replacements: { id: `${authUserId}-credential`, userId: authUserId, accountId: authUserId } },
    );
    await connection.sequelize.query(
      `INSERT INTO ba_session (id, "userId", token, "expiresAt", "ipAddress", "userAgent", "createdAt", "updatedAt")
       VALUES (:id, :userId, :token, NOW() + INTERVAL '1 day', '127.0.0.1', 'test-agent', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      { replacements: { id: `${authUserId}-session`, userId: authUserId, token: 'test-session-token' } },
    );

    // Simulate sign-in to get session cookies from the mock
    const loginRes = await makeAuthRequest({
      method: 'post',
      url: '/auth/sign-in/email',
      payload: {
        email: testEmail,
        password: testPassword,
      },
    });

    // Extract session cookies from the login response
    global.APP_AUTH_COOKIES = extractCookies(loginRes);

    // Don't waste time, just store base_currency to the global variable to not
    // call this request each time
    if (!global.BASE_CURRENCY || !global.MODELS_CURRENCIES) {
      const currencies = await makeRequest({
        method: 'get',
        url: '/models/currencies',
        raw: true,
      });

      global.MODELS_CURRENCIES = currencies;
      global.BASE_CURRENCY = currencies.find((item: any) => item.code === global.BASE_CURRENCY_CODE);
    }

    const baseCurrencyRes = await makeRequest({
      method: 'post',
      url: '/user/currencies/base',
      payload: { currencyCode: global.BASE_CURRENCY.code },
    });

    if (baseCurrencyRes.statusCode !== 200) {
      throw new Error(`Failed to set base currency: ${JSON.stringify(baseCurrencyRes.body)}`);
    }
  } catch (err) {
    console.error('Setup failed:', err);
    throw err;
  }
}, 20_000); // Timeout for test setup (truncate + create user + sign-in)

global.closeE2eResources = closeAllE2eResources;

async function closeAllE2eResources() {
  try {
    // Flush debounced categorization buffers before closing queues
    await flushAllPendingCategorizationBuffers();

    // Close ALL BullMQ workers and queues first to ensure no pending operations
    // This prevents "The client is closed" errors when workers try to access Redis
    await closeAllMonobankQueueBundles();
    await accountSyncWorker.close();
    await accountSyncQueue.close();
    await categorizationWorker.close();
    await categorizationQueue.close();
    await ynabImportWorker.close();
    await ynabImportQueue.close();
    await budgetBakersWalletImportWorker.close();
    await budgetBakersWalletImportQueue.close();
    await msMoneyImportWorker.close();
    await msMoneyImportQueue.close();
    await ofxImportWorker.close();
    await ofxImportQueue.close();
    await csvImportWorker.close();
    await csvImportQueue.close();
    await statementImportWorker.close();
    await statementImportQueue.close();
    await backupRestoreWorker.close();
    await backupRestoreQueue.close();
    await importBatchDeleteWorker.close();
    await importBatchDeleteQueue.close();
    await logoResolutionWorker.close();
    await logoResolutionQueue.close();
    await subscriptionReminderEmailWorker.close();
    await subscriptionReminderEmailQueue.close();
    await baseCurrencyChangeWorker.close();
    await baseCurrencyChangeQueue.close();
    await trackerScanWorker.close();
    await trackerScanQueue.close();

    // The chat tail holds a connection of its own to Redis.
    await chatTailHub.close();

    // Now safe to close Redis client
    await redisClient.quit();
    serverInstance.close();
    loadCurrencyRatesJob.stop();
  } catch (err) {
    console.log('afterAll', err);
  }
}

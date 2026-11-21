import { API_ERROR_CODES, TRANSACTION_TYPES } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import Transactions from '@models/transactions.model';
import { redisClient } from '@root/redis-client';
import { REDIS_KEYS, SyncStatus } from '@services/bank-data-providers/sync/sync-status-tracker';
import * as helpers from '@tests/helpers';

// Mark one of the user's accounts as actively syncing so the worker's drain never
// clears — used to deterministically fail the job on drain timeout.
const holdAccountSyncing = async ({ accountId }: { accountId: string }) => {
  await redisClient.set(
    REDIS_KEYS.accountSyncStatus(accountId),
    JSON.stringify({
      accountId,
      status: SyncStatus.SYNCING,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
    }),
  );
};

/**
 * GET /user/currencies/change-base/status. The change runs as a background job any
 * device polls to drive the blocking overlay. These tests drive the full lifecycle
 * (idle → queued/running → completed) through the HTTP helpers, plus the
 * double-enqueue 423 and a deterministic failure.
 */
describe('Base-currency change status endpoint', () => {
  beforeEach(async () => {
    // Pin base to GBP (matching the sibling suites — the seed carries GBP/EUR→USD
    // historical rates), then connect EUR (the account currency) and USD (the target).
    await helpers.makeRequest({
      method: 'post',
      url: '/user/currencies/base',
      payload: { currencyCode: 'GBP' },
    });
    await helpers.addUserCurrencies({
      currencyCodes: ['EUR', 'USD'],
      raw: true,
    });
  });

  it('walks idle → queued/running → completed and actually changes refAmounts', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({
        currencyCode: 'EUR',
        initialBalance: 10000,
      }),
      raw: true,
    });
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 5000,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
      }),
      raw: true,
    });
    const originalRefAmount = tx.refAmount;

    const before = await helpers.getBaseCurrencyChangeStatus({ raw: true });
    expect(before.state).toEqual('idle');

    const enqueue = await helpers.changeBaseCurrency({
      newCurrencyCode: 'USD',
    });
    expect(enqueue.statusCode).toEqual(202);
    expect(enqueue.body.response.jobId).toBeTruthy();
    expect(enqueue.body.response.state).toEqual('queued');

    // The 5s (test: 100ms) drain grace keeps the job non-terminal long enough to
    // observe it in-flight right after enqueue.
    const inFlight = await helpers.getBaseCurrencyChangeStatus({ raw: true });
    expect(['queued', 'running']).toContain(inFlight.state);

    const settled = await helpers.waitForBaseCurrencyChangeSettled();
    helpers.expectBaseCurrencyChangeCompleted(settled);
    expect(settled.result.transactionsUpdated).toBeGreaterThan(0);
    expect(settled.jobId).toEqual(enqueue.body.response.jobId);

    // refAmount was actually rewritten into the new base (EUR→USD ≠ EUR→AED).
    // No `raw: true` here — it would bypass the Money getter and yield cents,
    // making the inequality against the API's decimal trivially (vacuously) true.
    const updatedTx = await Transactions.findByPk(tx.id);
    expect(updatedTx!.refCurrencyCode).toEqual('USD');
    expect(updatedTx!.refAmount.toNumber()).not.toEqual(originalRefAmount);
  });

  it('holds the job non-terminal while an account syncs, then completes once the sync clears', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({
        currencyCode: 'EUR',
        initialBalance: 10000,
      }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 5000,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-01-15').toISOString(),
      }),
      raw: true,
    });

    // A syncing account keeps the worker's drain looping — the job cannot reach
    // its recalc while this holds.
    await holdAccountSyncing({ accountId: account.id });

    const enqueue = await helpers.changeBaseCurrency({
      newCurrencyCode: 'USD',
    });
    expect(enqueue.statusCode).toEqual(202);

    // While the sync is held, the job stays non-terminal. Poll a short window
    // (well inside the 3s test drain timeout) to prove it never completes early.
    for (let i = 0; i < 3; i++) {
      await helpers.sleep(150);
      const status = await helpers.getBaseCurrencyChangeStatus({ raw: true });
      expect(['queued', 'running']).toContain(status.state);
    }

    // Clearing the sync lets the next drain poll pass; the job then completes.
    await redisClient.del(REDIS_KEYS.accountSyncStatus(account.id));

    const settled = await helpers.waitForBaseCurrencyChangeSettled();
    helpers.expectBaseCurrencyChangeCompleted(settled);
    expect(settled.result.transactionsUpdated).toBeGreaterThan(0);
    expect(settled.jobId).toEqual(enqueue.body.response.jobId);
  });

  it('rejects a second enqueue while a change is already in progress', async () => {
    const first = await helpers.changeBaseCurrency({ newCurrencyCode: 'USD' });
    expect(first.statusCode).toEqual(202);

    // The lock is taken synchronously at enqueue (before the job is even queued),
    // so a second enqueue is rejected immediately — no wait for worker pickup.
    const second = await helpers.changeBaseCurrency({ newCurrencyCode: 'USD' });
    expect(second.statusCode).toEqual(ERROR_CODES.Locked);
    expect((second.body.response as unknown as { code: string }).code).toEqual(
      API_ERROR_CODES.baseCurrencyChangeInProgress,
    );

    // Drain the first job to terminal so it doesn't run against the next test's
    // truncated DB.
    const settled = await helpers.waitForBaseCurrencyChangeSettled();
    helpers.expectBaseCurrencyChangeCompleted(settled);
  });

  it('reports failed with an error message when a sync blocks the drain past its timeout', async () => {
    // A bank account left SYNCING blocks the worker's drain; the job fails on
    // timeout without mutating anything, and the lock is released in `finally`.
    const account = await helpers.createAccount({ raw: true });
    await holdAccountSyncing({ accountId: account.id });

    try {
      const status = await helpers.changeBaseCurrencyAndWait({
        newCurrencyCode: 'USD',
      });
      helpers.expectBaseCurrencyChangeFailed(status);
      expect(status.error).toBeTruthy();
    } finally {
      await redisClient.del(REDIS_KEYS.accountSyncStatus(account.id));
    }

    // The lock was released on failure, so a subsequent enqueue isn't rejected.
    const retry = await helpers.changeBaseCurrency({ newCurrencyCode: 'USD' });
    expect(retry.statusCode).toEqual(202);
    await helpers.waitForBaseCurrencyChangeSettled();
  });
});

import { type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';

const FOREIGN_CURRENCY = 'USD';
const AMOUNT = 10;
const TRANSACTION_TIME = new Date('2024-03-15T12:00:00.000Z');

const setForeignRate = ({ rate }: { rate: number }) =>
  helpers.editCurrencyExchangeRate({
    pairs: [
      { baseCode: FOREIGN_CURRENCY, quoteCode: global.BASE_CURRENCY_CODE, rate },
      { baseCode: global.BASE_CURRENCY_CODE, quoteCode: FOREIGN_CURRENCY, rate: 1 / rate },
    ],
    raw: true,
  });

const createForeignTransaction = async ({ accountId, amount = AMOUNT }: { accountId: RecordId; amount?: number }) => {
  const [transaction] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount,
      transactionType: TRANSACTION_TYPES.income,
      time: TRANSACTION_TIME.toISOString(),
    }),
    raw: true,
  });

  return transaction!;
};

describe('Converted-amount cache across a backup restore', () => {
  beforeEach(async () => {
    const user = (await helpers.makeRequest({ method: 'get', url: '/user', raw: true })) as { id: number };
    await RateLimitService.resetRateLimit(`backup:user:${user.id}`);
    await RateLimitService.resetRateLimit(`backup-restore:user:${user.id}`);
  });

  it('converts with the restored rate instead of a value cached for the same amount, pair and date', async () => {
    await helpers.addUserCurrencies({ currencyCodes: [FOREIGN_CURRENCY], raw: true });
    await helpers.updateUserCurrency({
      currency: { currencyCode: FOREIGN_CURRENCY, liveRateUpdate: false },
      raw: true,
    });
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: FOREIGN_CURRENCY }),
      raw: true,
    });

    // The archive carries the rate of 40.
    await setForeignRate({ rate: 40 });
    const exported = await helpers.exportBackup();
    expect(exported.statusCode).toBe(200);

    // A rate of 50 is live when this conversion caches its result.
    await setForeignRate({ rate: 50 });
    const cachedAtLiveRate = await createForeignTransaction({ accountId: account.id });
    expect(Number(cachedAtLiveRate.refAmount)).toBe(AMOUNT * 50);

    const restore = await helpers.restoreBackup({ fileContent: exported.body.toString('base64') });
    expect(restore.statusCode).toBe(200);
    const status = await helpers.waitForRestore({ jobId: restore.jobId! });
    expect(status.status).toBe('completed');

    const restoredAccount = (await helpers.getAccounts()).find((candidate) => candidate.name === account.name);
    expect(restoredAccount).toBeDefined();

    // An amount never converted before shows the restored rate itself is in force ...
    const uncached = await createForeignTransaction({ accountId: restoredAccount!.id, amount: AMOUNT + 1 });
    expect(Number(uncached.refAmount)).toBe((AMOUNT + 1) * 40);

    // ... and the amount cached at the live rate converts with it too.
    const afterRestore = await createForeignTransaction({ accountId: restoredAccount!.id });
    expect(Number(afterRestore.refAmount)).toBe(AMOUNT * 40);
  });
});

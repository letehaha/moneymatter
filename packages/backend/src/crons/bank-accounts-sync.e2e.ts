import { asDecimal } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { connection } from '@models/connection';
import { runBankAccountsSync } from '@root/crons/bank-accounts-sync';
import { redisClient } from '@root/redis-client';
import { buildLockKey } from '@services/currencies/base-currency-lock';
import * as helpers from '@tests/helpers';
import { getMockedLunchFlowTransactions } from '@tests/mocks/lunchflow/data';
import { getLunchFlowBalanceMock, getLunchFlowTransactionsMock } from '@tests/mocks/lunchflow/mock-api';
import { subDays } from 'date-fns';

/** The cron has no HTTP surface, so this e2e invokes it directly. */

const LUNCHFLOW_EXTERNAL_ACCOUNT_ID = 1001;

const atUtcHour = ({ hour }: { hour: number }) => {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};

/** Waits for the queued jobs so none is still running when the next test truncates the tables. */
const runCron = async ({ hour }: { hour: number }) => {
  const result = await runBankAccountsSync({ now: atUtcHour({ hour }) });
  await helpers.bankDataProviders.waitForAccountsSyncToSettle();
  return result;
};

const connectBankAccount = async () => {
  global.mswMockServer.use(
    getLunchFlowTransactionsMock({ response: { transactions: [], total: 0 } }),
    getLunchFlowBalanceMock({
      accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
      response: { balance: { amount: asDecimal(100), currency: global.BASE_CURRENCY.code } },
    }),
  );

  const { connectionId } = await helpers.lunchflow.pair();
  await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [String(LUNCHFLOW_EXTERNAL_ACCOUNT_ID)],
    raw: true,
  });
};

describe('Bank accounts sync cron', () => {
  it('syncs nobody when no user has a bank connection', async () => {
    expect(await runCron({ hour: 6 })).toEqual({ usersDue: 0, usersSynced: 0, usersSkipped: 0, usersFailed: 0 });
  });

  it('imports the transactions the bank reports at a scheduled hour', async () => {
    await connectBankAccount();
    const before = await helpers.getTransactions({ raw: true });

    global.mswMockServer.use(getLunchFlowTransactionsMock({ response: getMockedLunchFlowTransactions(1) }));
    expect((await runCron({ hour: 6 })).usersSynced).toBe(1);

    const after = await helpers.getTransactions({ raw: true });
    expect(after.length).toBe(before.length + 1);
    expect((await helpers.bankDataProviders.getAccountsSyncStatus({ raw: true })).lastSyncAt).not.toBeNull();
  });

  it('syncs at the default hours only, until the user sets their own', async () => {
    await connectBankAccount();

    expect((await runCron({ hour: 18 })).usersSynced).toBe(1);
    expect((await runCron({ hour: 9 })).usersDue).toBe(0);

    await helpers.patchUserSettings({ patch: { bankSyncHoursUtc: [9, 21] }, raw: true });

    expect((await runCron({ hour: 9 })).usersSynced).toBe(1);
    expect((await runCron({ hour: 18 })).usersDue).toBe(0);
  });

  it('syncs once a day when both slots hold the same hour', async () => {
    await connectBankAccount();
    await helpers.patchUserSettings({ patch: { bankSyncHoursUtc: [9, 9] }, raw: true });

    expect((await runCron({ hour: 9 })).usersSynced).toBe(1);
    expect((await runCron({ hour: 21 })).usersDue).toBe(0);
  });

  it('skips a user with no session activity in the last 7 days', async () => {
    await connectBankAccount();
    await connection.sequelize.query(`UPDATE ba_session SET "updatedAt" = NOW() - INTERVAL '8 days'`);

    expect((await runCron({ hour: 6 })).usersDue).toBe(0);
  });

  it('skips a user whose plan no longer includes bank providers', async () => {
    await connectBankAccount();
    await helpers.setUserBilling({ trialEndsAt: subDays(new Date(), 1) });

    expect(await runBankAccountsSync({ now: atUtcHour({ hour: 6 }) })).toEqual({
      usersDue: 1,
      usersSynced: 0,
      usersSkipped: 1,
      usersFailed: 0,
    });
  });

  it('skips a user while a base-currency change holds the lock', async () => {
    await connectBankAccount();
    const { id: userId } = await helpers.getUserInfo({ raw: true });
    await redisClient.set(buildLockKey(userId), 'test-lock');

    try {
      expect(await runCron({ hour: 6 })).toEqual({ usersDue: 1, usersSynced: 0, usersSkipped: 1, usersFailed: 0 });
    } finally {
      await redisClient.del(buildLockKey(userId));
    }
  });

  it.each([[[1, 2, 3]], [[9]], [[]]])('rejects sync hours %j', async (bankSyncHoursUtc) => {
    const response = await helpers.patchUserSettings({ patch: { bankSyncHoursUtc } });

    expect(response.statusCode).toBe(422);
  });
});

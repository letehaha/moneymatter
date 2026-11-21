import {
  ACCOUNT_CATEGORIES,
  BANK_PROVIDER_TYPE,
  type RecordId,
  TRANSACTION_TYPES,
  VEHICLE_CLASS,
  asDecimal,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';
import Accounts from '@models/accounts.model';
import { connection } from '@models/connection';
import { runBalanceRevalueSweep } from '@root/crons/balance-revalue-sweep';
import * as helpers from '@tests/helpers';
import {
  VALID_LUNCHFLOW_API_KEY,
  getLunchFlowBalanceMock,
  getLunchFlowTransactionsMock,
} from '@tests/mocks/lunchflow/mock-api';
import { format, subDays, subYears } from 'date-fns';
import { QueryTypes } from 'sequelize';
import { v7 as uuidv7 } from 'uuid';

/** The sweep has no HTTP surface, so this e2e invokes it directly. */

const CORRUPTED_CENTS = 99_999_900;

const dayKey = (date: Date) => format(date, 'yyyy-MM-dd');

const writeBalanceRow = async ({ accountId, date, cents }: { accountId: string; date: Date; cents: number }) => {
  await connection.sequelize.query(
    `INSERT INTO "Balances" ("id", "accountId", "date", "amount", "createdAt", "updatedAt")
     VALUES (:id, :accountId, :date, :amount, NOW(), NOW())
     ON CONFLICT ("accountId", "date") DO UPDATE SET "amount" = EXCLUDED."amount"`,
    {
      replacements: {
        id: uuidv7(),
        accountId,
        date: dayKey(date),
        amount: Money.fromDecimal(cents / 100).toDecimalString(18),
      },
    },
  );
};

const readBalanceRow = async ({ accountId, date }: { accountId: string; date: Date }): Promise<number | null> => {
  const [row] = (await connection.sequelize.query(
    `SELECT ROUND("amount" * 100)::bigint AS "cents" FROM "Balances" WHERE "accountId" = :accountId AND "date" = :date`,
    { type: QueryTypes.SELECT, replacements: { accountId, date: dayKey(date) } },
  )) as { cents: string }[];

  return row ? Number(row.cents) : null;
};

/** The stored DECIMAL as written, for assertions on the exact value at the base currency's decimals. */
const readBalanceAmount = async ({ accountId, date }: { accountId: string; date: Date }): Promise<Money | null> => {
  const [row] = (await connection.sequelize.query(
    `SELECT "amount" FROM "Balances" WHERE "accountId" = :accountId AND "date" = :date`,
    { type: QueryTypes.SELECT, replacements: { accountId, date: dayKey(date) } },
  )) as { amount: string }[];

  return row ? Money.fromDecimal(row.amount) : null;
};

const LUNCHFLOW_EXTERNAL_ACCOUNT_ID = 1001;
const BANK_BALANCE = 1000.5;

const connectBankAccount = async ({ currency }: { currency: string }): Promise<Accounts> => {
  global.mswMockServer.use(
    getLunchFlowTransactionsMock({ response: { transactions: [], total: 0 } }),
    getLunchFlowBalanceMock({
      accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
      response: { balance: { amount: asDecimal(BANK_BALANCE), currency } },
    }),
  );

  const { connectionId } = await helpers.lunchflow.pair();
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [String(LUNCHFLOW_EXTERNAL_ACCOUNT_ID)],
    raw: true,
  });

  return (await Accounts.findByPk(syncedAccounts[0]!.id))!;
};

const setAccountCategory = async ({ accountId, category }: { accountId: string; category: ACCOUNT_CATEGORIES }) => {
  await connection.sequelize.query(`UPDATE "Accounts" SET "accountCategory" = :category WHERE "id" = :accountId`, {
    replacements: { accountId, category },
  });
};

/** Opens a USD account at 1000 with an expense of 100 ten days back, then links it to a bank reporting 1200. */
const linkManualUsdAccount = async (): Promise<RecordId> => {
  const today = new Date();
  const account = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'USD', initialBalance: 1000 }),
    raw: true,
  });
  const [category] = await helpers.getCategoriesList();
  await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      amount: 100,
      transactionType: TRANSACTION_TYPES.expense,
      time: subDays(today, 10).toISOString(),
      categoryId: category!.id as RecordId,
    }),
    raw: true,
  });

  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
    credentials: { apiKey: VALID_LUNCHFLOW_API_KEY },
    raw: true,
  });
  global.mswMockServer.use(
    getLunchFlowTransactionsMock({ response: { transactions: [], total: 0 } }),
    getLunchFlowBalanceMock({
      accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
      response: { balance: { amount: asDecimal(1200), currency: 'USD' } },
    }),
  );
  await helpers.linkAccountToBankConnection({
    id: account.id,
    connectionId,
    externalAccountId: String(LUNCHFLOW_EXTERNAL_ACCOUNT_ID),
    raw: true,
  });

  return account.id;
};

describe('Nightly balance revalue sweep', () => {
  it('rebuilds a foreign-currency account, dropping a value it did not compute', async () => {
    const { account } = await helpers.createAccountWithNewCurrency({ currency: 'UAH' });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 1000,
        time: subDays(new Date(), 10).toISOString(),
      }),
      raw: true,
    });

    const corruptedDay = subDays(new Date(), 5);
    await writeBalanceRow({ accountId: account.id, date: corruptedDay, cents: CORRUPTED_CENTS });

    const result = await runBalanceRevalueSweep();

    expect(result.totalProcessed).toBe(1);
    expect(result.successfulUpdates).toBe(1);
    expect(result.failedUpdates).toBe(0);

    // The rebuild owns every day from the grid start on: the corrupted row is either
    // rewritten with the day's real value or deleted as a day that carries no change.
    expect(await readBalanceRow({ accountId: account.id, date: corruptedDay })).not.toBe(CORRUPTED_CENTS);
  });

  it('re-values today for a foreign-currency bank account the provider did not sync', async () => {
    const today = new Date();
    // 1000.5 USD × 2.25 = 2251.125 AED: a tie at the base currency's 2 decimals, which half-even
    // rounds down to 2251.12 where half-up would give 2251.13 and no rounding would keep 2251.125.
    await helpers.seedUsdExchangeRates({ date: today, ratesPerUsd: { AED: 2.25 } });

    const account = await connectBankAccount({ currency: 'USD' });
    await writeBalanceRow({ accountId: account.id, date: today, cents: CORRUPTED_CENTS });

    const result = await runBalanceRevalueSweep();

    expect(result.totalProcessed).toBe(1);
    expect(result.successfulUpdates).toBe(1);
    expect(account.currentBalance.toNumber()).toBe(BANK_BALANCE);
    expect((await readBalanceAmount({ accountId: account.id, date: today }))?.toDecimalString(3)).toBe('2251.120');
  });

  it('rebuilds the days before the seam of a linked manual account and leaves the seam day on alone', async () => {
    const user = await helpers.provisionSecondUserWithBaseCurrency({ currencyCode: 'USD' });
    const today = new Date();
    const corruptedDay = subDays(today, 5);

    const accountId = await helpers.asUser({ cookies: user.cookies, fn: linkManualUsdAccount });

    await writeBalanceRow({ accountId, date: corruptedDay, cents: CORRUPTED_CENTS });
    await writeBalanceRow({ accountId, date: today, cents: CORRUPTED_CENTS });

    const result = await runBalanceRevalueSweep();

    expect(result.failedUpdates).toBe(0);
    // Opening balance 1300 after the 200 residual, minus the 100 expense ten days back.
    const history = await helpers.asUser({
      cookies: user.cookies,
      fn: () => helpers.getBalanceHistory({ accountId, raw: true }),
    });
    expect(helpers.balanceCentsOn({ rows: history, date: corruptedDay })).toBe(120_000);
    expect(await readBalanceRow({ accountId, date: subDays(today, 11) })).toBe(130_000);
    expect(await readBalanceRow({ accountId, date: today })).toBe(CORRUPTED_CENTS);
  });

  it('leaves the opening balance of untouched linked manual accounts exactly as linking left it', async () => {
    const usdBaseUser = await helpers.provisionSecondUserWithBaseCurrency({ currencyCode: 'USD' });
    const baseCurrencyAccountId = await helpers.asUser({ cookies: usdBaseUser.cookies, fn: linkManualUsdAccount });

    await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
    const foreignCurrencyAccountId = await linkManualUsdAccount();

    const readOpening = async () =>
      [
        await helpers.asUser({
          cookies: usdBaseUser.cookies,
          fn: () => helpers.getAccount({ id: baseCurrencyAccountId, raw: true }),
        }),
        await helpers.getAccount({ id: foreignCurrencyAccountId, raw: true }),
      ].map(({ initialBalance, refInitialBalance }) => ({ initialBalance, refInitialBalance }));
    const before = await readOpening();

    const result = await runBalanceRevalueSweep();

    expect(result.failedUpdates).toBe(0);
    expect(await readOpening()).toEqual(before);
  });

  it('leaves a bank account in the base currency alone', async () => {
    const today = new Date();
    const account = await connectBankAccount({ currency: global.BASE_CURRENCY.code });

    await writeBalanceRow({ accountId: account.id, date: today, cents: CORRUPTED_CENTS });

    const result = await runBalanceRevalueSweep();

    expect(result.totalProcessed).toBe(0);
    expect(await readBalanceRow({ accountId: account.id, date: today })).toBe(CORRUPTED_CENTS);
  });

  it('skips base-currency accounts, loans that own their balance history and vehicles on a depreciation curve', async () => {
    const baseCurrencyAccount = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: global.BASE_CURRENCY.code }),
      raw: true,
    });

    // Also registers UAH for the user — the vehicle below relies on it; keep this before the vehicle.
    const { account: loanAccount } = await helpers.createAccountWithNewCurrency({ currency: 'UAH' });
    await setAccountCategory({ accountId: loanAccount.id, category: ACCOUNT_CATEGORIES.loan });

    const vehicle = await helpers.createVehicle({
      name: 'Toyota Camry 2020',
      currencyCode: 'UAH',
      make: 'Toyota',
      model: 'Camry',
      year: 2020,
      vehicleClass: VEHICLE_CLASS.sedan,
      purchasePrice: 25000,
      purchaseDate: format(subYears(new Date(), 3), 'yyyy-MM-dd'),
      raw: true,
    });

    const untouchedDay = subDays(new Date(), 5);
    const skippedAccountIds = [baseCurrencyAccount.id, loanAccount.id, vehicle.accountId];

    for (const accountId of skippedAccountIds) {
      await writeBalanceRow({ accountId, date: untouchedDay, cents: CORRUPTED_CENTS });
    }

    const result = await runBalanceRevalueSweep();

    expect(result.totalProcessed).toBe(0);

    for (const accountId of skippedAccountIds) {
      expect(await readBalanceRow({ accountId, date: untouchedDay })).toBe(CORRUPTED_CENTS);
    }
  }, 30_000);
});

import {
  ACCOUNT_STATUSES,
  type AccountApiResponse,
  BANK_PROVIDER_TYPE,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_PERIOD_STATUSES,
  TRANSACTION_TRANSFER_NATURE,
  type LinkResidualTarget,
  type RecordId,
  TRANSACTION_TYPES,
  asDecimal,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { connection } from '@models/connection';
import * as helpers from '@tests/helpers';
import { getMockedLunchFlowTransactions } from '@tests/mocks/lunchflow/data';
import {
  VALID_LUNCHFLOW_API_KEY,
  getLunchFlowBalanceMock,
  getLunchFlowTransactionsMock,
} from '@tests/mocks/lunchflow/mock-api';
import { addHours, addMinutes, eachDayOfInterval, format, startOfDay, subDays } from 'date-fns';

/**
 * A manual account linked to a bank keeps its seam balance S (the balance at the start
 * of the link day) fixed. Manual rows dated before the link day stay editable: the
 * opening balance absorbs the edit (`initialBalance = S − Σ pre-seam rows`) and only
 * the Balances rows before the link day are rebuilt. The bank keeps `currentBalance`
 * and every day from the link day on.
 */

const LUNCHFLOW_EXTERNAL_ACCOUNT_ID = '1001';
const TODAY = startOfDay(new Date());
const TODAY_KEY = format(TODAY, 'yyyy-MM-dd');
const dayAgo = ({ days }: { days: number }) => addHours(subDays(TODAY, days), 12);
const HISTORY_DAYS = eachDayOfInterval({ start: subDays(TODAY, 12), end: TODAY });

type BalanceRows = Awaited<ReturnType<typeof helpers.getBalanceHistory<true>>>;

const dateKey = ({ date }: { date: string | Date }) =>
  typeof date === 'string' ? date.slice(0, 10) : format(date, 'yyyy-MM-dd');

const readHistory = ({ accountId }: { accountId: string }) => helpers.getBalanceHistory({ accountId, raw: true });

const rowsFromSeam = ({ rows }: { rows: BalanceRows }) =>
  rows
    .filter((row) => dateKey({ date: row.date }) >= TODAY_KEY)
    .map((row) => ({ date: dateKey({ date: row.date }), amount: row.amount }))
    .toSorted((a, b) => a.date.localeCompare(b.date));

const chartCents = ({ rows }: { rows: BalanceRows }) =>
  HISTORY_DAYS.map((date) => helpers.balanceCentsOn({ rows, date }));

const chartBeforeSeam = ({ rows }: { rows: BalanceRows }) =>
  HISTORY_DAYS.filter((date) => date < TODAY).map((date) => helpers.balanceCentsOn({ rows, date }));

const centsOn = ({ rows, daysAgo }: { rows: BalanceRows; daysAgo: number }) =>
  helpers.balanceCentsOn({ rows, date: subDays(TODAY, daysAgo) });

const readAccount = ({ accountId }: { accountId: string }) =>
  helpers.getAccount({ id: accountId, raw: true }) as unknown as Promise<AccountApiResponse>;

/** Runs the scenario as a user whose base currency is USD, so the LunchFlow USD account has no exchange rate. */
const asUsdBaseUser = async (fn: () => Promise<void>) => {
  const user = await helpers.provisionSecondUserWithBaseCurrency({ currencyCode: 'USD' });
  await helpers.asUser({ cookies: user.cookies, fn });
};

const createManualRow = async ({
  accountId,
  amount,
  transactionType,
  time,
}: {
  accountId: RecordId;
  amount: number;
  transactionType: TRANSACTION_TYPES;
  time: Date;
}) => {
  const [category] = await helpers.getCategoriesList();
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount,
      transactionType,
      time: time.toISOString(),
      categoryId: category!.id as RecordId,
    }),
    raw: true,
  });
  return tx!;
};

const createUsdAccount = async ({ initialBalance = 1000 }: { initialBalance?: number } = {}) =>
  helpers.createAccount({
    payload: helpers.buildAccountPayload({ name: 'Manual account', currencyCode: 'USD', initialBalance }),
    raw: true,
  });

/** Links `accountId` to a LunchFlow account reporting a balance of 1200. */
const linkToLunchFlow = async ({
  accountId,
  connectionId,
  externalAccountId = LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
  currency = 'USD',
  residualTarget,
  bankTransactions = { transactions: [], total: 0 },
}: {
  accountId: RecordId;
  connectionId?: string;
  externalAccountId?: string;
  currency?: string;
  residualTarget?: LinkResidualTarget;
  bankTransactions?: ReturnType<typeof getMockedLunchFlowTransactions>;
}) => {
  const resolvedConnectionId =
    connectionId ??
    (
      await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
        credentials: { apiKey: VALID_LUNCHFLOW_API_KEY },
        raw: true,
      })
    ).connectionId;

  global.mswMockServer.use(
    getLunchFlowTransactionsMock({ response: bankTransactions, accountId: externalAccountId }),
    getLunchFlowBalanceMock({
      accountId: externalAccountId,
      response: { balance: { amount: asDecimal(1200), currency } },
    }),
  );

  const linkResponse = await helpers.linkAccountToBankConnection({
    id: accountId,
    connectionId: resolvedConnectionId,
    externalAccountId,
    residualTarget,
    raw: false,
  });
  expect(linkResponse.statusCode).toBe(200);

  return { connectionId: resolvedConnectionId };
};

/**
 * Account opened at 1000 with an expense of 100 ten days back and an income of 50
 * five days back, then linked to a bank reporting 1200.
 */
const setupLinkedAccount = async ({
  residualTarget,
  bankTransactions,
  manualRows = [
    { amount: 100, transactionType: TRANSACTION_TYPES.expense, time: dayAgo({ days: 10 }) },
    { amount: 50, transactionType: TRANSACTION_TYPES.income, time: dayAgo({ days: 5 }) },
  ],
}: {
  residualTarget?: LinkResidualTarget;
  bankTransactions?: ReturnType<typeof getMockedLunchFlowTransactions>;
  manualRows?: { amount: number; transactionType: TRANSACTION_TYPES; time: Date }[];
} = {}) => {
  const account = await createUsdAccount();

  const rows: Awaited<ReturnType<typeof createManualRow>>[] = [];
  for (const row of manualRows) {
    rows.push(await createManualRow({ accountId: account.id, ...row }));
  }

  const { connectionId } = await linkToLunchFlow({ accountId: account.id, residualTarget, bankTransactions });

  const linked = await readAccount({ accountId: account.id });
  expect(linked.currentBalance).toBe(1200);

  return { accountId: account.id as RecordId, connectionId, rows, expenseRow: rows[0]!, incomeRow: rows[1]! };
};

const createTransfer = async ({
  fromAccountId,
  toAccountId,
  amount,
  destinationAmount = amount,
  time,
}: {
  fromAccountId: RecordId;
  toAccountId: RecordId;
  amount: number;
  destinationAmount?: number;
  time: Date;
}) => {
  const [category] = await helpers.getCategoriesList();
  const [fromLeg, toLeg] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: fromAccountId,
      amount,
      destinationAmount,
      destinationAccountId: toAccountId,
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      transactionType: TRANSACTION_TYPES.expense,
      time: time.toISOString(),
      categoryId: category!.id as RecordId,
    }),
    raw: true,
  });
  return { fromLeg: fromLeg!, toLeg: toLeg! };
};

/** No HTTP call can date a link in the past, so the test moves the stored link moment. */
const backdateLink = async ({ accountId, linkedAt }: { accountId: RecordId; linkedAt: Date }) => {
  await connection.sequelize.query(
    `UPDATE "Accounts"
        SET "externalData" = jsonb_set("externalData", '{bankConnection,linkedAt}', to_jsonb(CAST(:linkedAt AS text)))
      WHERE "id" = :accountId`,
    { replacements: { accountId, linkedAt: linkedAt.toISOString() } },
  );
};

const snapshot = async ({ accountId }: { accountId: string }) => {
  const [account, history] = await Promise.all([readAccount({ accountId }), readHistory({ accountId })]);
  return { account, history };
};

describe('Editing history before the bank seam', () => {
  it('editing a pre-seam amount moves only the opening balance and the days before the row', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, expenseRow } = await setupLinkedAccount();
      const before = await snapshot({ accountId });
      // Residual 250 absorbed into the opening balance: S = 1250 − 100 + 50 = 1200.
      expect(before.account.initialBalance).toBe(1250);

      const response = await helpers.updateTransaction({ id: expenseRow.id, payload: { amount: 300 } });
      expect(response.statusCode).toBe(200);

      const after = await snapshot({ accountId });
      expect(after.account.currentBalance).toBe(1200);
      expect(after.account.initialBalance).toBe(1450);
      expect(after.account.refInitialBalance).toBe(1450);
      expect(rowsFromSeam({ rows: after.history })).toEqual(rowsFromSeam({ rows: before.history }));

      expect(centsOn({ rows: after.history, daysAgo: 11 })).toBe(145_000);
      expect(centsOn({ rows: after.history, daysAgo: 10 })).toBe(115_000);
      expect(centsOn({ rows: after.history, daysAgo: 5 })).toBe(120_000);
      expect(centsOn({ rows: after.history, daysAgo: 1 })).toBe(120_000);
      expect(centsOn({ rows: before.history, daysAgo: 10 })).toBe(115_000);
    });
  });

  it.each([
    ['single delete', 'single'],
    ['bulk delete', 'bulk'],
  ] as [string, 'single' | 'bulk'][])(
    '%s of a pre-seam row moves only the opening balance and the days before the row',
    async (_, mode) => {
      await asUsdBaseUser(async () => {
        const { accountId, incomeRow } = await setupLinkedAccount();
        const before = await snapshot({ accountId });

        const response =
          mode === 'single'
            ? await helpers.deleteTransaction({ id: incomeRow.id })
            : await helpers.bulkDeleteTransactions({ payload: { transactionIds: [incomeRow.id as RecordId] } });
        expect(response.statusCode).toBe(200);

        const after = await snapshot({ accountId });
        expect(after.account.currentBalance).toBe(1200);
        expect(after.account.initialBalance).toBe(1300);
        expect(rowsFromSeam({ rows: after.history })).toEqual(rowsFromSeam({ rows: before.history }));

        expect(centsOn({ rows: after.history, daysAgo: 11 })).toBe(130_000);
        expect(centsOn({ rows: after.history, daysAgo: 6 })).toBe(120_000);
        expect(centsOn({ rows: after.history, daysAgo: 5 })).toBe(120_000);
        expect(centsOn({ rows: after.history, daysAgo: 1 })).toBe(120_000);
      });
    },
  );

  it('moves a pre-seam row to another pre-seam day and rejects moving it onto the seam day or later', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, expenseRow } = await setupLinkedAccount();
      const before = await snapshot({ accountId });

      const moved = await helpers.updateTransaction({
        id: expenseRow.id,
        payload: { time: dayAgo({ days: 3 }).toISOString() },
      });
      expect(moved.statusCode).toBe(200);

      const after = await snapshot({ accountId });
      expect(after.account.currentBalance).toBe(1200);
      expect(after.account.initialBalance).toBe(1250);
      expect(rowsFromSeam({ rows: after.history })).toEqual(rowsFromSeam({ rows: before.history }));
      expect(centsOn({ rows: after.history, daysAgo: 7 })).toBe(125_000);
      expect(centsOn({ rows: after.history, daysAgo: 4 })).toBe(130_000);
      expect(centsOn({ rows: after.history, daysAgo: 3 })).toBe(120_000);

      for (const time of [addHours(TODAY, 1), addHours(TODAY, 30)]) {
        const rejected = await helpers.updateTransaction({ id: expenseRow.id, payload: { time: time.toISOString() } });
        expect(rejected.statusCode).toBe(ERROR_CODES.ValidationError);
      }

      expect(await snapshot({ accountId })).toEqual(after);
    });
  });

  it('rejects moving a pre-seam row to another account', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, expenseRow } = await setupLinkedAccount();
      const other = await createUsdAccount();
      const before = await Promise.all([snapshot({ accountId }), snapshot({ accountId: other.id })]);

      const response = await helpers.updateTransaction({ id: expenseRow.id, payload: { accountId: other.id } });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      expect(await Promise.all([snapshot({ accountId }), snapshot({ accountId: other.id })])).toEqual(before);
    });
  });

  it('keeps bank-typed rows read-only', async () => {
    await asUsdBaseUser(async () => {
      const bankTransactions = getMockedLunchFlowTransactions(1);
      bankTransactions.transactions[0]!.amount = asDecimal(-40);
      // LunchFlow drops rows dated before the link moment on an account with stored rows.
      bankTransactions.transactions[0]!.date = addMinutes(new Date(), 1).toISOString();

      const { accountId } = await setupLinkedAccount({ bankTransactions });
      const bankRow = (await helpers.getTransactions({ accountIds: [accountId], raw: true })).find(
        (tx) => tx.accountType !== 'system',
      )!;
      expect(bankRow).toBeDefined();
      const before = await snapshot({ accountId });

      for (const payload of [
        { amount: 10 },
        { time: dayAgo({ days: 4 }).toISOString() },
        { transactionType: TRANSACTION_TYPES.income },
      ]) {
        const response = await helpers.updateTransaction({ id: bankRow.id, payload });
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      }

      const deleted = await helpers.deleteTransaction({ id: bankRow.id });
      expect(deleted.statusCode).toBe(ERROR_CODES.ValidationError);
      const bulkDeleted = await helpers.bulkDeleteTransactions({
        payload: { transactionIds: [bankRow.id as RecordId] },
      });
      expect(bulkDeleted.statusCode).toBe(ERROR_CODES.ValidationError);

      expect(await snapshot({ accountId })).toEqual(before);
    });
  });

  it('keeps the invariants after an edit when the link residual went to an adjustment row', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, expenseRow } = await setupLinkedAccount({ residualTarget: 'adjustment' });
      const before = await snapshot({ accountId });
      const openingBefore = before.account.initialBalance;

      const response = await helpers.updateTransaction({ id: expenseRow.id, payload: { amount: 300 } });
      expect(response.statusCode).toBe(200);

      const after = await snapshot({ accountId });
      expect(after.account.currentBalance).toBe(1200);
      expect(after.account.initialBalance).toBe(openingBefore + 200);
      expect(rowsFromSeam({ rows: after.history })).toEqual(rowsFromSeam({ rows: before.history }));
      expect(centsOn({ rows: after.history, daysAgo: 11 })).toBe((openingBefore + 200) * 100);
      expect(centsOn({ rows: after.history, daysAgo: 10 })).toBe(centsOn({ rows: before.history, daysAgo: 10 }));

      const transactions = await helpers.getTransactions({ accountIds: [accountId], raw: true });
      const signedSum = transactions.reduce(
        (acc, tx) => acc + (tx.transactionType === TRANSACTION_TYPES.income ? 1 : -1) * Number(tx.amount),
        0,
      );
      expect(after.account.initialBalance + signedSum).toBe(after.account.currentBalance);
    });
  });

  it('rebuilds the foreign-currency days before the seam at each day’s rate and leaves the seam on untouched', async () => {
    const seededDays = [...HISTORY_DAYS, subDays(TODAY, 13)];
    try {
      for (const date of seededDays) {
        await helpers.seedUsdExchangeRates({ date, ratesPerUsd: { AED: helpers.AED_PER_USD } });
      }
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });

      const { accountId, expenseRow } = await setupLinkedAccount();
      const before = await snapshot({ accountId });

      const response = await helpers.updateTransaction({ id: expenseRow.id, payload: { amount: 300 } });
      expect(response.statusCode).toBe(200);

      const after = await snapshot({ accountId });
      expect(after.account.currentBalance).toBe(1200);
      expect(after.account.initialBalance).toBe(1450);
      expect(after.account.refInitialBalance).toBe(1450 * helpers.AED_PER_USD);
      expect(rowsFromSeam({ rows: after.history })).toEqual(rowsFromSeam({ rows: before.history }));

      expect(centsOn({ rows: after.history, daysAgo: 11 })).toBe(145_000 * helpers.AED_PER_USD);
      expect(centsOn({ rows: after.history, daysAgo: 10 })).toBe(115_000 * helpers.AED_PER_USD);
      expect(centsOn({ rows: after.history, daysAgo: 5 })).toBe(120_000 * helpers.AED_PER_USD);
      expect(centsOn({ rows: after.history, daysAgo: 1 })).toBe(120_000 * helpers.AED_PER_USD);
    } finally {
      await helpers.clearExchangeRatesForDates({ dates: seededDays });
    }
  });

  it('keeps edits of rows from the seam day on locked and the balances unchanged', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, expenseRow } = await setupLinkedAccount({
        manualRows: [{ amount: 100, transactionType: TRANSACTION_TYPES.expense, time: addHours(TODAY, 1) }],
      });
      const before = await snapshot({ accountId });
      expect(before.account.initialBalance).toBe(1300);

      for (const payload of [
        { amount: 300 },
        { time: dayAgo({ days: 2 }).toISOString() },
        { transactionType: TRANSACTION_TYPES.income },
      ]) {
        const edited = await helpers.updateTransaction({ id: expenseRow.id, payload });
        expect(edited.statusCode).toBe(ERROR_CODES.ValidationError);
      }

      expect(await snapshot({ accountId })).toEqual(before);
    });
  });

  it('behaves as a plain manual account again after unlink', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, expenseRow } = await setupLinkedAccount();
      await helpers.updateTransaction({ id: expenseRow.id, payload: { amount: 300 }, raw: true });

      await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: true });
      const before = await snapshot({ accountId });
      expect(before.account.initialBalance).toBe(1450);

      const response = await helpers.updateTransaction({ id: expenseRow.id, payload: { amount: 200 } });
      expect(response.statusCode).toBe(200);

      const after = await snapshot({ accountId });
      expect(after.account.currentBalance).toBe(1300);
      expect(after.account.initialBalance).toBe(1450);
      expect(centsOn({ rows: after.history, daysAgo: 11 })).toBe(145_000);
      expect(centsOn({ rows: after.history, daysAgo: 0 })).toBe(130_000);
    });
  });

  it.each([['unlink'], ['archive']] as ['unlink' | 'archive'][])(
    're-derives a stale opening balance from the seam balance on %s',
    async (mode) => {
      await asUsdBaseUser(async () => {
        const { accountId } = await setupLinkedAccount();
        const linked = await snapshot({ accountId });

        // What a pre-seam rebuild that failed after its row write committed leaves behind.
        await connection.sequelize.query(`UPDATE "Accounts" SET "initialBalance" = 0 WHERE "id" = :accountId`, {
          replacements: { accountId },
        });

        const response =
          mode === 'unlink'
            ? await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: false })
            : await helpers.updateAccount({ id: accountId, payload: { status: ACCOUNT_STATUSES.archived } });
        expect(response.statusCode).toBe(200);

        const after = await snapshot({ accountId });
        expect(after.account.bankSeamAt).toBeNull();
        expect(after.account.initialBalance).toBe(linked.account.initialBalance);
        expect(after.account.currentBalance).toBe(linked.account.currentBalance);
        expect(chartBeforeSeam({ rows: after.history })).toEqual(chartBeforeSeam({ rows: linked.history }));
      });
    },
  );

  it('returns history to its original values when two edits cancel out', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, expenseRow } = await setupLinkedAccount();
      const before = await snapshot({ accountId });

      await helpers.updateTransaction({ id: expenseRow.id, payload: { amount: 300 }, raw: true });
      await helpers.updateTransaction({ id: expenseRow.id, payload: { amount: 100 }, raw: true });

      const after = await snapshot({ accountId });
      expect(after.account).toEqual(before.account);
      expect(chartCents({ rows: after.history })).toEqual(chartCents({ rows: before.history }));
      expect(rowsFromSeam({ rows: after.history })).toEqual(rowsFromSeam({ rows: before.history }));
    });
  });

  it('flips the type of a pre-seam row and keeps the ledger identity', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, incomeRow } = await setupLinkedAccount();
      const before = await snapshot({ accountId });

      const response = await helpers.updateTransaction({
        id: incomeRow.id,
        payload: { transactionType: TRANSACTION_TYPES.expense },
      });
      expect(response.statusCode).toBe(200);

      const after = await snapshot({ accountId });
      expect(after.account.currentBalance).toBe(1200);
      expect(after.account.initialBalance).toBe(1350);
      expect(rowsFromSeam({ rows: after.history })).toEqual(rowsFromSeam({ rows: before.history }));
      expect(centsOn({ rows: after.history, daysAgo: 6 })).toBe(125_000);
      expect(centsOn({ rows: after.history, daysAgo: 5 })).toBe(120_000);
    });
  });

  it('treats the last millisecond before the seam day as editable and the seam day start as locked', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, expenseRow, incomeRow } = await setupLinkedAccount({
        manualRows: [
          { amount: 100, transactionType: TRANSACTION_TYPES.expense, time: new Date(+TODAY - 1) },
          { amount: 50, transactionType: TRANSACTION_TYPES.expense, time: TODAY },
        ],
      });

      const editable = await helpers.updateTransaction({ id: expenseRow.id, payload: { amount: 200 } });
      expect(editable.statusCode).toBe(200);

      const before = await snapshot({ accountId });
      const locked = await helpers.updateTransaction({ id: incomeRow.id, payload: { amount: 70 } });
      expect(locked.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await snapshot({ accountId })).toEqual(before);
      expect(before.account.currentBalance).toBe(1200);
    });
  });

  describe('transfers touching a seam account', () => {
    it('rejects moving the manual leg so the seam-side leg lands on or after the seam', async () => {
      await asUsdBaseUser(async () => {
        const manual = await createUsdAccount();
        const seamAccount = await createUsdAccount();
        const { fromLeg } = await createTransfer({
          fromAccountId: manual.id,
          toAccountId: seamAccount.id,
          amount: 100,
          time: dayAgo({ days: 7 }),
        });
        await linkToLunchFlow({ accountId: seamAccount.id });
        const before = await Promise.all([snapshot({ accountId: manual.id }), snapshot({ accountId: seamAccount.id })]);

        for (const time of [addHours(TODAY, 1), addHours(TODAY, 30)]) {
          const response = await helpers.updateTransaction({ id: fromLeg.id, payload: { time: time.toISOString() } });
          expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        }

        expect(
          await Promise.all([snapshot({ accountId: manual.id }), snapshot({ accountId: seamAccount.id })]),
        ).toEqual(before);
      });
    });

    it('rejects an edit on one seam account that would push the other leg past its own earlier seam', async () => {
      await asUsdBaseUser(async () => {
        const usdAccount = await createUsdAccount();
        const eurAccount = await helpers.createAccount({
          payload: helpers.buildAccountPayload({ name: 'EUR account', currencyCode: 'EUR', initialBalance: 1000 }),
          raw: true,
        });
        const { fromLeg } = await createTransfer({
          fromAccountId: usdAccount.id,
          toAccountId: eurAccount.id,
          amount: 100,
          destinationAmount: 90,
          time: dayAgo({ days: 7 }),
        });
        const { connectionId } = await linkToLunchFlow({ accountId: usdAccount.id });
        await linkToLunchFlow({ accountId: eurAccount.id, connectionId, externalAccountId: '1002', currency: 'EUR' });
        await backdateLink({ accountId: eurAccount.id, linkedAt: dayAgo({ days: 5 }) });

        const before = await Promise.all([
          snapshot({ accountId: usdAccount.id }),
          snapshot({ accountId: eurAccount.id }),
        ]);

        const response = await helpers.updateTransaction({
          id: fromLeg.id,
          payload: { time: dayAgo({ days: 3 }).toISOString() },
        });
        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

        expect(
          await Promise.all([snapshot({ accountId: usdAccount.id }), snapshot({ accountId: eurAccount.id })]),
        ).toEqual(before);
      });
    });

    it('edits a pre-seam transfer amount from either side, moving only the manual side’s current balance', async () => {
      await asUsdBaseUser(async () => {
        const manual = await createUsdAccount();
        const seamAccount = await createUsdAccount();
        const { fromLeg, toLeg } = await createTransfer({
          fromAccountId: manual.id,
          toAccountId: seamAccount.id,
          amount: 100,
          time: dayAgo({ days: 7 }),
        });
        await linkToLunchFlow({ accountId: seamAccount.id });
        const seamBefore = await snapshot({ accountId: seamAccount.id });
        expect((await readAccount({ accountId: manual.id })).currentBalance).toBe(900);

        const fromManual = await helpers.updateTransaction({ id: fromLeg.id, payload: { amount: 150 } });
        expect(fromManual.statusCode).toBe(200);

        let manualAfter = await snapshot({ accountId: manual.id });
        let seamAfter = await snapshot({ accountId: seamAccount.id });
        expect(manualAfter.account.currentBalance).toBe(850);
        expect(seamAfter.account.currentBalance).toBe(1200);
        expect(seamAfter.account.initialBalance).toBe(seamBefore.account.initialBalance - 50);
        expect(rowsFromSeam({ rows: seamAfter.history })).toEqual(rowsFromSeam({ rows: seamBefore.history }));
        expect(centsOn({ rows: manualAfter.history, daysAgo: 7 })).toBe(85_000);
        expect(centsOn({ rows: seamAfter.history, daysAgo: 8 })).toBe((seamBefore.account.initialBalance - 50) * 100);
        expect(centsOn({ rows: seamAfter.history, daysAgo: 7 })).toBe(120_000);

        const fromSeam = await helpers.updateTransaction({ id: toLeg.id, payload: { amount: 200 } });
        expect(fromSeam.statusCode).toBe(200);

        manualAfter = await snapshot({ accountId: manual.id });
        seamAfter = await snapshot({ accountId: seamAccount.id });
        expect(manualAfter.account.currentBalance).toBe(800);
        expect(seamAfter.account.currentBalance).toBe(1200);
        expect(seamAfter.account.initialBalance).toBe(seamBefore.account.initialBalance - 100);
        expect(rowsFromSeam({ rows: seamAfter.history })).toEqual(rowsFromSeam({ rows: seamBefore.history }));
        expect(centsOn({ rows: manualAfter.history, daysAgo: 7 })).toBe(80_000);
        expect(centsOn({ rows: seamAfter.history, daysAgo: 7 })).toBe(120_000);
      });
    });

    it('refuses an edit of a manual leg that would rewrite its linked bank leg, and leaves the bank leg alone on a note edit', async () => {
      await asUsdBaseUser(async () => {
        const bankTransactions = getMockedLunchFlowTransactions(1);
        bankTransactions.transactions[0]!.amount = asDecimal(-40);
        bankTransactions.transactions[0]!.date = addMinutes(new Date(), 1).toISOString();
        const { accountId: seamAccountId } = await setupLinkedAccount({ bankTransactions });
        const bankLeg = await pickTransaction({ accountId: seamAccountId, match: (tx) => tx.accountType !== 'system' });

        const manual = await createUsdAccount();
        const manualLeg = await createManualRow({
          accountId: manual.id,
          amount: 40,
          transactionType: TRANSACTION_TYPES.income,
          time: dayAgo({ days: 3 }),
        });
        const linked = await helpers.linkTransactions({ payload: { ids: [[manualLeg.id, bankLeg.id]] } });
        expect(linked.statusCode).toBe(200);
        const before = await snapshot({ accountId: seamAccountId });

        for (const payload of [{ amount: 60 }, { time: dayAgo({ days: 2 }).toISOString() }]) {
          const response = await helpers.updateTransaction({ id: manualLeg.id, payload });
          expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
        }

        const noteOnly = await helpers.updateTransaction({
          id: manualLeg.id,
          payload: { note: 'rent', amount: 40, time: new Date(manualLeg.time).toISOString() },
        });
        expect(noteOnly.statusCode).toBe(200);

        const bankAfter = await helpers.getTransactionById({ id: bankLeg.id, raw: true });
        expect({ amount: bankAfter!.amount, time: bankAfter!.time }).toEqual({
          amount: bankLeg.amount,
          time: bankLeg.time,
        });
        expect(await snapshot({ accountId: seamAccountId })).toEqual(before);
      });
    });
  });

  it('gives a manual account reconnected through the connect flow its seam back', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, connectionId, expenseRow } = await setupLinkedAccount();
      await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: true });

      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [LUNCHFLOW_EXTERNAL_ACCOUNT_ID],
        raw: true,
      });
      const before = await snapshot({ accountId });
      expect(before.account.type).not.toBe('system');

      const response = await helpers.updateTransaction({ id: expenseRow.id, payload: { amount: 300 } });
      expect(response.statusCode).toBe(200);

      const after = await snapshot({ accountId });
      expect(after.account.currentBalance).toBe(before.account.currentBalance);
      expect(after.account.initialBalance).toBe(before.account.initialBalance + 200);
      expect(rowsFromSeam({ rows: after.history })).toEqual(rowsFromSeam({ rows: before.history }));
    });
  });
});

const pickTransaction = async ({ accountId, match }: { accountId: RecordId; match: (tx: TransactionRow) => boolean }) =>
  (await helpers.getTransactions({ accountIds: [accountId], raw: true })).find(match)!;

type TransactionRow = Awaited<ReturnType<typeof helpers.getTransactions<true>>>[number];

const signedSumOf = async ({ accountId }: { accountId: RecordId }) =>
  (await helpers.getTransactions({ accountIds: [accountId], raw: true })).reduce(
    (sum, tx) => sum + (tx.transactionType === TRANSACTION_TYPES.income ? 1 : -1) * Number(tx.amount),
    0,
  );

const expectOpeningShift = async ({
  accountId,
  before,
  shift,
}: {
  accountId: RecordId;
  before: Awaited<ReturnType<typeof snapshot>>;
  shift: number;
}) => {
  const after = await snapshot({ accountId });
  expect(after.account.currentBalance).toBe(before.account.currentBalance);
  expect(after.account.initialBalance).toBe(before.account.initialBalance + shift);
  expect(rowsFromSeam({ rows: after.history })).toEqual(rowsFromSeam({ rows: before.history }));
};

describe('Deleting and restoring manual rows on a seam account', () => {
  it.each([['single'], ['bulk']] as ['single' | 'bulk'][])(
    'refuses to delete a manual row dated on the seam day (%s)',
    async (mode) => {
      await asUsdBaseUser(async () => {
        const { accountId, expenseRow } = await setupLinkedAccount({
          manualRows: [{ amount: 100, transactionType: TRANSACTION_TYPES.expense, time: addHours(TODAY, 1) }],
        });
        const before = await snapshot({ accountId });

        if (mode === 'bulk') {
          const response = await helpers.bulkDeleteTransactions({
            payload: { transactionIds: [expenseRow.id as RecordId] },
          });
          expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
          const error = response.body.response as unknown as { details?: { disallowedIds?: string[] } };
          expect(error.details?.disallowedIds).toEqual([expenseRow.id]);
        } else {
          expect((await helpers.deleteTransaction({ id: expenseRow.id })).statusCode).toBe(ERROR_CODES.ValidationError);
        }

        expect(await helpers.getTransactionById({ id: expenseRow.id, raw: true })).not.toBeNull();
        expect(await snapshot({ accountId })).toEqual(before);
      });
    },
  );

  it('refuses a bulk delete that includes a bank row or a seam-day manual row, then deletes the pre-seam row', async () => {
    await asUsdBaseUser(async () => {
      const bankTransactions = getMockedLunchFlowTransactions(1);
      bankTransactions.transactions[0]!.amount = asDecimal(-40);
      bankTransactions.transactions[0]!.date = addMinutes(new Date(), 1).toISOString();
      const { accountId, rows } = await setupLinkedAccount({
        bankTransactions,
        manualRows: [
          { amount: 100, transactionType: TRANSACTION_TYPES.expense, time: dayAgo({ days: 10 }) },
          { amount: 30, transactionType: TRANSACTION_TYPES.expense, time: addHours(TODAY, 1) },
        ],
      });
      const bankRow = await pickTransaction({ accountId, match: (tx) => tx.accountType !== 'system' });
      const [preSeamRow, seamDayRow] = rows.map((row) => row.id as RecordId);
      const before = await snapshot({ accountId });

      const mixed = await helpers.bulkDeleteTransactions({
        payload: { transactionIds: [preSeamRow!, seamDayRow!, bankRow.id as RecordId] },
      });
      expect(mixed.statusCode).toBe(ERROR_CODES.ValidationError);
      const mixedError = mixed.body.response as unknown as { details?: { disallowedIds?: string[] } };
      expect(mixedError.details?.disallowedIds?.toSorted()).toEqual([seamDayRow!, bankRow.id].toSorted());
      for (const id of [preSeamRow!, seamDayRow!, bankRow.id]) {
        expect(await helpers.getTransactionById({ id, raw: true })).not.toBeNull();
      }
      expect(await snapshot({ accountId })).toEqual(before);

      const preSeamOnly = await helpers.bulkDeleteTransactions({ payload: { transactionIds: [preSeamRow!] } });
      expect(preSeamOnly.statusCode).toBe(200);
      await expectOpeningShift({ accountId, before, shift: -100 });
    });
  });

  it('keeps current = initial + Σ rows after unlink, since a manual row dated on the link day cannot be deleted', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, rows } = await setupLinkedAccount({
        manualRows: [
          { amount: 100, transactionType: TRANSACTION_TYPES.expense, time: dayAgo({ days: 10 }) },
          { amount: 50, transactionType: TRANSACTION_TYPES.income, time: dayAgo({ days: 5 }) },
          { amount: 30, transactionType: TRANSACTION_TYPES.expense, time: addHours(TODAY, 1) },
        ],
      });
      expect((await helpers.deleteTransaction({ id: rows[2]!.id })).statusCode).toBe(ERROR_CODES.ValidationError);

      expect((await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: false })).statusCode).toBe(200);

      const account = await readAccount({ accountId });
      const signedSum = await signedSumOf({ accountId });
      expect({
        currentBalance: account.currentBalance,
        initialBalance: account.initialBalance,
        signedSum,
      }).toEqual({ currentBalance: 1200, initialBalance: 1280, signedSum: -80 });
      expect(account.currentBalance).toBe(account.initialBalance + signedSum);
    });
  });

  it('unlinks an account whose stored link moment is unreadable', async () => {
    await asUsdBaseUser(async () => {
      const { accountId } = await setupLinkedAccount();
      // No endpoint stores a malformed link moment; a legacy or hand-edited row can.
      await connection.sequelize.query(
        `UPDATE "Accounts" SET "externalData" = jsonb_set("externalData", '{bankConnection,linkedAt}', '"not-a-date"')
          WHERE "id" = :accountId`,
        { replacements: { accountId } },
      );

      const response = await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: false });
      expect(response.statusCode).toBe(200);
      expect((await readAccount({ accountId })).type).toBe('system');
    });
  });

  it('keeps the link-time adjustment row read-only and undeletable', async () => {
    await asUsdBaseUser(async () => {
      const { accountId } = await setupLinkedAccount({ residualTarget: 'adjustment' });
      const adjustment = await pickTransaction({
        accountId,
        match: (tx) => tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      });
      expect(adjustment).toBeDefined();
      const before = await snapshot({ accountId });

      const edited = await helpers.updateTransaction({ id: adjustment.id, payload: { amount: 1 } });
      expect(edited.statusCode).toBe(ERROR_CODES.ValidationError);

      const deleted = await helpers.deleteTransaction({ id: adjustment.id });
      expect(deleted.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await helpers.getTransactionById({ id: adjustment.id, raw: true })).not.toBeNull();
      expect(await snapshot({ accountId })).toEqual(before);
    });
  });

  it('returns every balance to its start after trashing and restoring a pre-seam row', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, expenseRow } = await setupLinkedAccount();
      const before = await snapshot({ accountId });

      expect((await helpers.deleteTransaction({ id: expenseRow.id })).statusCode).toBe(200);
      await expectOpeningShift({ accountId, before, shift: -100 });

      const restored = await helpers.restoreTrash({ transactionIds: [expenseRow.id as RecordId] });
      expect(restored.statusCode).toBe(200);

      const after = await snapshot({ accountId });
      expect(after.account).toEqual(before.account);
      expect(chartCents({ rows: after.history })).toEqual(chartCents({ rows: before.history }));
      expect(rowsFromSeam({ rows: after.history })).toEqual(rowsFromSeam({ rows: before.history }));
    });
  });

  it('starts a new link day anchored to the bank on a connect-flow relink, then restores a row trashed while unlinked before it', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, connectionId, expenseRow } = await setupLinkedAccount();

      await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: true });
      expect((await helpers.deleteTransaction({ id: expenseRow.id })).statusCode).toBe(200);
      await backdateLink({ accountId, linkedAt: dayAgo({ days: 7 }) });
      await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [LUNCHFLOW_EXTERNAL_ACCOUNT_ID],
        raw: true,
      });

      // Bank 1200 with only the +50 income live: S = 1200, opening 1150.
      const relinked = await snapshot({ accountId });
      expect(relinked.account.bankSeamAt).toBe(TODAY.toISOString());
      expect(relinked.account.currentBalance).toBe(1200);
      expect(relinked.account.initialBalance).toBe(1150);

      const restored = await helpers.restoreTrash({ transactionIds: [expenseRow.id as RecordId] });
      expect(restored.statusCode).toBe(200);

      await expectOpeningShift({ accountId, before: relinked, shift: 100 });
      const after = await snapshot({ accountId });
      expect(centsOn({ rows: after.history, daysAgo: 11 })).toBe(125_000);
      expect(centsOn({ rows: after.history, daysAgo: 1 })).toBe(120_000);
    });
  });

  it('pins the balances of a pre-link row trashed while linked and restored after unlink', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, expenseRow } = await setupLinkedAccount();

      expect((await helpers.deleteTransaction({ id: expenseRow.id })).statusCode).toBe(200);
      await helpers.unlinkAccountFromBankConnection({ id: accountId, raw: true });
      const restored = await helpers.restoreTrash({ transactionIds: [expenseRow.id as RecordId] });
      expect(restored.statusCode).toBe(200);

      const after = await readAccount({ accountId });
      expect({ initialBalance: after.initialBalance, currentBalance: after.currentBalance }).toEqual({
        initialBalance: 1150,
        currentBalance: 1100,
      });
    });
  });

  it('restores a row trashed before the account was linked: only the opening balance and the days before the link move', async () => {
    await asUsdBaseUser(async () => {
      const account = await createUsdAccount();
      const expenseRow = await createManualRow({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        time: dayAgo({ days: 10 }),
      });
      expect((await helpers.deleteTransaction({ id: expenseRow.id })).statusCode).toBe(200);
      await linkToLunchFlow({ accountId: account.id });
      const before = await snapshot({ accountId: account.id });

      const restored = await helpers.restoreTrash({ transactionIds: [expenseRow.id as RecordId] });
      expect(restored.statusCode).toBe(200);

      await expectOpeningShift({ accountId: account.id, before, shift: 100 });
      const after = await snapshot({ accountId: account.id });
      expect(after.account.currentBalance).toBe(1200);
      expect(centsOn({ rows: after.history, daysAgo: 11 })).toBe((before.account.initialBalance + 100) * 100);
      expect(centsOn({ rows: after.history, daysAgo: 10 })).toBe(120_000);
      expect(centsOn({ rows: after.history, daysAgo: 1 })).toBe(120_000);
    });
  });

  it('refuses to restore a manual row dated on the link day that was trashed before the link', async () => {
    await asUsdBaseUser(async () => {
      const account = await createUsdAccount();
      const seamDayRow = await createManualRow({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        time: addHours(TODAY, 1),
      });
      expect((await helpers.deleteTransaction({ id: seamDayRow.id })).statusCode).toBe(200);
      await linkToLunchFlow({ accountId: account.id });
      const before = await snapshot({ accountId: account.id });

      const restored = await helpers.restoreTrash({ transactionIds: [seamDayRow.id as RecordId] });
      expect(restored.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await helpers.getTransactionById({ id: seamDayRow.id, raw: true })).toBeNull();
      expect(await snapshot({ accountId: account.id })).toEqual(before);

      await helpers.unlinkAccountFromBankConnection({ id: account.id, raw: true });
      const unlinked = await readAccount({ accountId: account.id });
      expect(unlinked.currentBalance).toBe(unlinked.initialBalance + (await signedSumOf({ accountId: account.id })));
    });
  });

  it('refuses to delete a transfer whose seam-day leg sits on a seam account', async () => {
    await asUsdBaseUser(async () => {
      const manual = await createUsdAccount();
      const seamAccount = await createUsdAccount();
      const { fromLeg, toLeg } = await createTransfer({
        fromAccountId: manual.id,
        toAccountId: seamAccount.id,
        amount: 100,
        time: addHours(TODAY, 1),
      });
      await linkToLunchFlow({ accountId: seamAccount.id });
      const seamBefore = await snapshot({ accountId: seamAccount.id });

      expect((await helpers.deleteTransaction({ id: fromLeg.id })).statusCode).toBe(ERROR_CODES.ValidationError);
      for (const id of [fromLeg.id, toLeg.id]) {
        expect(await helpers.getTransactionById({ id, raw: true })).not.toBeNull();
      }
      expect((await readAccount({ accountId: manual.id })).currentBalance).toBe(900);
      expect(await snapshot({ accountId: seamAccount.id })).toEqual(seamBefore);
    });
  });

  it('deletes a pre-seam transfer between two seam accounts, rebuilding both histories', async () => {
    await asUsdBaseUser(async () => {
      const usdAccount = await createUsdAccount();
      const eurAccount = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'EUR account', currencyCode: 'EUR', initialBalance: 1000 }),
        raw: true,
      });
      const { fromLeg } = await createTransfer({
        fromAccountId: usdAccount.id,
        toAccountId: eurAccount.id,
        amount: 100,
        destinationAmount: 90,
        time: dayAgo({ days: 7 }),
      });
      const { connectionId } = await linkToLunchFlow({ accountId: usdAccount.id });
      await linkToLunchFlow({ accountId: eurAccount.id, connectionId, externalAccountId: '1002', currency: 'EUR' });
      const usdBefore = await snapshot({ accountId: usdAccount.id });
      const eurBefore = await snapshot({ accountId: eurAccount.id });

      expect((await helpers.deleteTransaction({ id: fromLeg.id })).statusCode).toBe(200);

      await expectOpeningShift({ accountId: usdAccount.id, before: usdBefore, shift: -100 });
      await expectOpeningShift({ accountId: eurAccount.id, before: eurBefore, shift: 90 });
    });
  });

  it('reverting a subscription period deletes its generated pre-seam row and rebuilds the history', async () => {
    await asUsdBaseUser(async () => {
      const account = await createUsdAccount();
      const [category] = await helpers.getCategoriesList();
      const dueDate = format(subDays(TODAY, 5), 'yyyy-MM-dd');
      const sub = await helpers.createSubscription({
        name: 'Streaming',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: dueDate,
        dueDate,
        accountId: account.id,
        categoryId: category!.id,
        expectedAmount: 20,
        expectedCurrencyCode: 'USD',
        raw: true,
      });
      const period = (await helpers.getSubscriptionById({ id: sub.id, raw: true })).periods.find((item) =>
        [SUBSCRIPTION_PERIOD_STATUSES.upcoming, SUBSCRIPTION_PERIOD_STATUSES.overdue].includes(
          item.status as SUBSCRIPTION_PERIOD_STATUSES,
        ),
      )!;
      const paid = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: period.id,
        createTransaction: true,
        time: dayAgo({ days: 5 }).toISOString(),
        raw: true,
      });
      await linkToLunchFlow({ accountId: account.id });
      const before = await snapshot({ accountId: account.id });

      const reverted = await helpers.revertSubscriptionPeriod({ id: sub.id, periodId: period.id });
      expect(reverted.statusCode).toBe(200);

      expect(await helpers.getTransactionById({ id: paid.transactionId!, raw: true })).toBeNull();
      await expectOpeningShift({ accountId: account.id, before, shift: -20 });
    });
  });
});

describe('Pre-seam rows with links to other records', () => {
  it('edits the amount of a row with splits', async () => {
    await asUsdBaseUser(async () => {
      const account = await createUsdAccount();
      const [category] = await helpers.getCategoriesList();
      const [row] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          time: dayAgo({ days: 6 }).toISOString(),
          categoryId: category!.id as RecordId,
          splits: [{ categoryId: category!.id as RecordId, amount: 40 }],
        }),
        raw: true,
      });
      await linkToLunchFlow({ accountId: account.id });
      const before = await snapshot({ accountId: account.id });

      const response = await helpers.updateTransaction({ id: row!.id, payload: { amount: 300 } });
      expect(response.statusCode).toBe(200);
      await expectOpeningShift({ accountId: account.id, before, shift: 200 });
    });
  });

  it('edits the amount of a row linked as a refund target', async () => {
    await asUsdBaseUser(async () => {
      const account = await createUsdAccount();
      const original = await createManualRow({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        time: dayAgo({ days: 8 }),
      });
      const [category] = await helpers.getCategoriesList();
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 30,
          transactionType: TRANSACTION_TYPES.income,
          time: dayAgo({ days: 6 }).toISOString(),
          categoryId: category!.id as RecordId,
          refundForTxId: original.id as RecordId,
        }),
        raw: true,
      });
      await linkToLunchFlow({ accountId: account.id });
      const before = await snapshot({ accountId: account.id });

      const response = await helpers.updateTransaction({ id: original.id, payload: { amount: 300 } });
      expect(response.statusCode).toBe(200);
      await expectOpeningShift({ accountId: account.id, before, shift: 200 });
    });
  });

  it('edits the amount of a row inside a transaction group', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, expenseRow, incomeRow } = await setupLinkedAccount();
      const group = await helpers.createTransactionGroup({
        payload: { name: 'Trip', transactionIds: [expenseRow.id, incomeRow.id] },
      });
      expect(group.statusCode).toBe(200);
      const before = await snapshot({ accountId });

      const response = await helpers.updateTransaction({ id: expenseRow.id, payload: { amount: 300 } });
      expect(response.statusCode).toBe(200);
      await expectOpeningShift({ accountId, before, shift: 200 });
    });
  });

  it('edits the amount of a row linked to a subscription', async () => {
    await asUsdBaseUser(async () => {
      const { accountId, expenseRow } = await setupLinkedAccount();
      const [category] = await helpers.getCategoriesList();
      const sub = await helpers.createSubscription({
        name: 'Gym',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: format(subDays(TODAY, 10), 'yyyy-MM-dd'),
        accountId,
        categoryId: category!.id,
        expectedAmount: 100,
        expectedCurrencyCode: 'USD',
        raw: true,
      });
      const linked = await helpers.linkTransactionsToSubscription({ id: sub.id, transactionIds: [expenseRow.id] });
      expect(linked.statusCode).toBe(200);
      const before = await snapshot({ accountId });

      const response = await helpers.updateTransaction({ id: expenseRow.id, payload: { amount: 300 } });
      expect(response.statusCode).toBe(200);
      await expectOpeningShift({ accountId, before, shift: 200 });
    });
  });

  it('moves a payment whose created leg sits on a seam account only within the pre-seam range', async () => {
    await asUsdBaseUser(async () => {
      const manual = await createUsdAccount();
      const seamAccount = await createUsdAccount();
      const [category] = await helpers.getCategoriesList();
      const [main] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: manual.id,
          amount: 70,
          time: dayAgo({ days: 6 }).toISOString(),
          categoryId: category!.id as RecordId,
          paymentLegs: [{ accountId: seamAccount.id, amount: 30 }],
        }),
        raw: true,
      });
      await linkToLunchFlow({ accountId: seamAccount.id });
      const leg = await pickTransaction({ accountId: seamAccount.id, match: (tx) => tx.paymentParentId === main!.id });
      const seamBefore = await snapshot({ accountId: seamAccount.id });

      const editLeg = await helpers.updateTransaction({ id: leg.id, payload: { amount: 10 } });
      expect(editLeg.statusCode).toBe(ERROR_CODES.ValidationError);

      const pastSeam = await helpers.updateTransaction({
        id: main!.id,
        payload: { time: addHours(TODAY, 1).toISOString() },
      });
      expect(pastSeam.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await snapshot({ accountId: seamAccount.id })).toEqual(seamBefore);

      const moved = await helpers.updateTransaction({
        id: main!.id,
        payload: { time: dayAgo({ days: 3 }).toISOString() },
      });
      expect(moved.statusCode).toBe(200);
      await expectOpeningShift({ accountId: seamAccount.id, before: seamBefore, shift: 0 });
      const seamAfter = await snapshot({ accountId: seamAccount.id });
      expect(centsOn({ rows: seamAfter.history, daysAgo: 5 })).toBe(centsOn({ rows: seamBefore.history, daysAgo: 7 }));
      expect((await readAccount({ accountId: manual.id })).currentBalance).toBe(930);
    });
  });
  it('re-dates a payment whose created leg sits on the seam day without moving the bank balance', async () => {
    await asUsdBaseUser(async () => {
      const manual = await createUsdAccount();
      const seamAccount = await createUsdAccount();
      const [category] = await helpers.getCategoriesList();
      const [main] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: manual.id,
          amount: 70,
          time: addMinutes(TODAY, 1).toISOString(),
          categoryId: category!.id as RecordId,
          paymentLegs: [{ accountId: seamAccount.id, amount: 30 }],
        }),
        raw: true,
      });
      await linkToLunchFlow({ accountId: seamAccount.id });
      const leg = await pickTransaction({ accountId: seamAccount.id, match: (tx) => tx.paymentParentId === main!.id });
      const seamBefore = await snapshot({ accountId: seamAccount.id });

      const response = await helpers.updateTransaction({
        id: main!.id,
        payload: {
          time: addMinutes(TODAY, 2).toISOString(),
          paymentLegs: [{ transactionId: leg.id as RecordId, amount: 20 }],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(await snapshot({ accountId: seamAccount.id })).toEqual(seamBefore);
    });
  });
});

describe('Seam start on the account API', () => {
  it('returns the link day start for a linked manual account and null otherwise', async () => {
    const manual = await helpers.createAccount({ raw: true });
    await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
    const linked = await createUsdAccount();
    await linkToLunchFlow({ accountId: linked.id });

    const detail = await readAccount({ accountId: linked.id });
    expect(detail.bankSeamAt).toBe(TODAY.toISOString());
    expect((await readAccount({ accountId: manual.id })).bankSeamAt).toBeNull();

    const listed = await helpers.getAccounts();
    expect(listed.find((account) => account.id === linked.id)).toMatchObject({ bankSeamAt: TODAY.toISOString() });
    expect(listed.find((account) => account.id === manual.id)).toMatchObject({ bankSeamAt: null });

    await helpers.unlinkAccountFromBankConnection({ id: linked.id, raw: true });
    expect((await readAccount({ accountId: linked.id })).bankSeamAt).toBeNull();
  });

  it('leaves the stored seam balance out of the link and unlink responses', async () => {
    await asUsdBaseUser(async () => {
      const account = await createUsdAccount();
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
        credentials: { apiKey: VALID_LUNCHFLOW_API_KEY },
        raw: true,
      });
      global.mswMockServer.use(
        getLunchFlowTransactionsMock({
          response: { transactions: [], total: 0 },
          accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
        }),
        getLunchFlowBalanceMock({
          accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
          response: { balance: { amount: asDecimal(1200), currency: 'USD' } },
        }),
      );

      const linked = await helpers.linkAccountToBankConnection({
        id: account.id,
        connectionId,
        externalAccountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
        raw: false,
      });
      expect(linked.statusCode).toBe(200);
      expect(helpers.extractResponse(linked).account).toMatchObject({ bankSeamAt: TODAY.toISOString() });
      expect(helpers.extractResponse(linked).account).not.toHaveProperty('seamBalance');

      const unlinked = await helpers.unlinkAccountFromBankConnection({ id: account.id, raw: false });
      expect(unlinked.statusCode).toBe(200);
      expect(helpers.extractResponse(unlinked)).toMatchObject({ id: account.id, bankSeamAt: null });
      expect(helpers.extractResponse(unlinked)).not.toHaveProperty('seamBalance');
    });
  });

  it('returns null for an account created by a bank connection', async () => {
    const { connectionId } = await helpers.lunchflow.pair();
    const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
      connectionId,
      accountExternalIds: [LUNCHFLOW_EXTERNAL_ACCOUNT_ID],
      raw: true,
    });

    expect((await readAccount({ accountId: syncedAccounts[0]!.id })).bankSeamAt).toBeNull();
  });
});

/** An import worker still writing rows leaves its batch without `finishedAt`. */
const setImportRunning = async ({ batchId, running }: { batchId: string; running: boolean }) => {
  await connection.sequelize.query(
    `UPDATE "ImportBatches" SET "finishedAt" = ${running ? 'NULL' : 'NOW()'} WHERE "batchId" = :batchId`,
    { replacements: { batchId } },
  );
};

describe('Linking while an import is running', () => {
  it('rejects link, unlink and a connect-flow relink until the import finishes', async () => {
    await asUsdBaseUser(async () => {
      const account = await createUsdAccount();
      const { batchId } = await helpers.runCsvImport({ accountId: account.id, currencyCode: 'USD' });
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
        credentials: { apiKey: VALID_LUNCHFLOW_API_KEY },
        raw: true,
      });
      global.mswMockServer.use(
        getLunchFlowTransactionsMock({
          response: { transactions: [], total: 0 },
          accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
        }),
        getLunchFlowBalanceMock({
          accountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
          response: { balance: { amount: asDecimal(1200), currency: 'USD' } },
        }),
      );
      const link = () =>
        helpers.linkAccountToBankConnection({
          id: account.id,
          connectionId,
          externalAccountId: LUNCHFLOW_EXTERNAL_ACCOUNT_ID,
          raw: false,
        });
      const unlink = () => helpers.unlinkAccountFromBankConnection({ id: account.id, raw: false });

      await setImportRunning({ batchId, running: true });
      expect((await link()).statusCode).toBe(ERROR_CODES.Locked);
      await setImportRunning({ batchId, running: false });
      expect((await link()).statusCode).toBe(200);

      await setImportRunning({ batchId, running: true });
      expect((await unlink()).statusCode).toBe(ERROR_CODES.Locked);
      await setImportRunning({ batchId, running: false });
      expect((await unlink()).statusCode).toBe(200);

      await setImportRunning({ batchId, running: true });
      const relink = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [LUNCHFLOW_EXTERNAL_ACCOUNT_ID],
      });
      expect(relink.statusCode).toBe(ERROR_CODES.Locked);
      expect((await readAccount({ accountId: account.id })).type).toBe('system');

      await setImportRunning({ batchId, running: false });
      const relinked = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: [LUNCHFLOW_EXTERNAL_ACCOUNT_ID],
      });
      expect(relinked.statusCode).toBe(200);
      expect((await readAccount({ accountId: account.id })).type).not.toBe('system');
    });
  });
});

import { ACCOUNT_CATEGORIES, API_ERROR_CODES, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { roundHalfToEven } from '@common/utils/round-half-to-even';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { connection } from '@models/index';
import { redisClient } from '@root/redis-client';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';
import { addDays, format, startOfMonth, subDays, subMonths } from 'date-fns';

const today = () => format(new Date(), 'yyyy-MM-dd');
const inDays = (days: number) => format(addDays(new Date(), days), 'yyyy-MM-dd');
/** The 10th of the month `monthsAgo` months back, clear of month and timezone edges. */
const tenthOf = (monthsAgo: number) => addDays(startOfMonth(subMonths(new Date(), monthsAgo)), 9);
/** Ref amounts are whole cents, banker's-rounded. */
const toBaseDecimal = ({ amount, rate }: { amount: number; rate: number }) =>
  roundHalfToEven(amount * 100 * rate) / 100;

const createAccount = ({
  initialBalance = 0,
  creditLimit = 0,
  currencyCode,
}: { initialBalance?: number; creditLimit?: number; currencyCode?: string } = {}) =>
  helpers.createAccount({
    payload: helpers.buildAccountPayload({
      accountCategory: ACCOUNT_CATEGORIES.saving,
      initialBalance,
      creditLimit,
      ...(currencyCode && { currencyCode }),
    }),
    raw: true,
  });

const depositMonthly = async ({
  accountId,
  monthsAgo,
  amount,
}: {
  accountId: RecordId;
  monthsAgo: number[];
  amount: number;
}) => {
  for (const months of monthsAgo) {
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId,
        amount,
        transactionType: TRANSACTION_TYPES.income,
        time: tenthOf(months).toISOString(),
      }),
      raw: true,
    });
  }
};

describe('Goal insights', () => {
  it('builds pace, ETA, needed per month and status from backdated history', async () => {
    const account = await createAccount();
    // +100 on the 10th of each of the last 9 months.
    await depositMonthly({ accountId: account.id, monthsAgo: [9, 8, 7, 6, 5, 4, 3, 2, 1], amount: 100 });

    const goal = await helpers.createGoal({
      payload: {
        accounts: [{ accountId: account.id, sharePercent: 100 }],
        targetAmount: 2100,
        targetDate: inDays(380),
      },
      raw: true,
    });
    const insights = (await helpers.getGoal({ goalId: goal.id, raw: true })).insights!;

    expect(insights.input.months).toHaveLength(13);
    expect(insights.input.months.at(-1)).toBe(today());
    expect(insights.input.accounts[0]!.firstDataDate).toBe(format(subDays(tenthOf(9), 1), 'yyyy-MM-dd'));
    // Months 0–2 predate the first deposit; month 3 holds it.
    expect(insights.monthEndValues).toEqual([0, 0, 0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 900]);

    expect(insights).toMatchObject({
      status: 'on_track',
      currentValue: 900,
      remaining: 1200,
      historicalPace: 100,
      historyMonths: 6,
      pace: 100,
      etaMonths: 12,
      daysLeft: 380,
      neededMonthly: Math.round(120_000 / (380 / 30.44)) / 100,
      rateToBase: 1,
      baseCurrencyCode: global.BASE_CURRENCY.code,
    });

    const behind = await helpers.updateGoal({ goalId: goal.id, payload: { targetDate: inDays(180) }, raw: true });
    expect(behind.insights!.status).toBe('behind');

    const ahead = await helpers.updateGoal({ goalId: goal.id, payload: { targetDate: inDays(730) }, raw: true });
    expect(ahead.insights!.status).toBe('ahead');

    const planned = await helpers.updateGoal({ goalId: goal.id, payload: { plannedMonthly: 400 }, raw: true });
    expect(planned.insights).toMatchObject({ historicalPace: 100, pace: 400, etaMonths: 3 });

    const undated = await helpers.updateGoal({
      goalId: goal.id,
      payload: { targetDate: null, plannedMonthly: null },
      raw: true,
    });
    expect(undated.insights).toMatchObject({ status: 'no_date', etaMonths: 12, neededMonthly: null, daysLeft: null });
  });

  it('reports insufficient_history for an account with under three months of data', async () => {
    const account = await createAccount();
    await depositMonthly({ accountId: account.id, monthsAgo: [2, 1], amount: 100 });

    const goal = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 100 }], targetDate: inDays(365) },
      raw: true,
    });

    expect(goal.insights).toMatchObject({
      status: 'insufficient_history',
      currentValue: 200,
      historicalPace: null,
      historyMonths: 1,
      pace: null,
      etaMonths: null,
    });
  });

  it('counts a partial share, and splits one account between two goals in one list read', async () => {
    const account = await createAccount({ initialBalance: 1000 });

    const vacation = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 60 }] },
      raw: true,
    });
    const laptop = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 40 }] },
      raw: true,
    });

    const goals = await helpers.listGoals({ raw: true });
    const byId = new Map(goals.map((goal) => [goal.id, goal]));

    expect(byId.get(vacation.id)!.insights).toMatchObject({ currentValue: 600, remaining: 400 });
    expect(byId.get(laptop.id)!.insights).toMatchObject({ currentValue: 400, remaining: 600 });
    expect(byId.get(laptop.id)!.insights!.input.accounts).toEqual([
      expect.objectContaining({ accountId: account.id, sharePercent: 40, currentBalance: 1000 }),
    ]);
  });

  it('subtracts the credit limit from the balance', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({
        accountCategory: ACCOUNT_CATEGORIES.general,
        initialBalance: 1500,
        creditLimit: 1000,
      }),
      raw: true,
    });

    const goal = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 50 }] },
      raw: true,
    });

    expect(goal.insights!.input.accounts[0]).toMatchObject({ currentBalance: 1500, creditLimit: 1000 });
    expect(goal.insights!.currentValue).toBe(250);
    expect(goal.insights!.monthEndValues.at(-1)).toBe(250);
  });

  it('still counts an account excluded from stats, history included', async () => {
    const account = await createAccount({ initialBalance: 1000 });
    await depositMonthly({ accountId: account.id, monthsAgo: [3], amount: 200 });
    await helpers.updateAccount({ id: account.id, payload: { excludeFromStats: true }, raw: true });

    const goal = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 100 }] },
      raw: true,
    });

    expect(goal.insights!.currentValue).toBe(1200);
    expect(goal.insights!.monthEndValues[0]).toBe(1000);
    expect(goal.insights!.monthEndValues.at(-1)).toBe(1200);
  });

  it('converts a foreign-currency target to base at today’s rate', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['USD'] });
    const account = await createAccount({ initialBalance: 500, currencyCode: 'USD' });

    const goal = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 100 }], currencyCode: 'USD', targetAmount: 500 },
      raw: true,
    });
    const insights = goal.insights!;

    expect(insights.rateToBase).not.toBe(1);
    expect(insights.input.targetAmount).toBe(toBaseDecimal({ amount: 500, rate: insights.rateToBase }));
    // Target and balance both sit at today's rate, so 500 USD held covers a 500 USD target.
    expect(insights.currentValue).toBeCloseTo(insights.input.targetAmount, 2);
    expect(insights.status).toBe('reached');
  });

  it('converts a target in a currency the user never connected', async () => {
    const goal = await helpers.createGoal({
      payload: {
        accounts: [{ accountId: (await createAccount({ initialBalance: 100 })).id, sharePercent: 100 }],
        currencyCode: 'EUR',
        targetAmount: 1000,
      },
      raw: true,
    });

    expect(goal.insights!.rateToBase).toBeGreaterThan(0);
    expect(goal.insights!.input.targetAmount).toBe(toBaseDecimal({ amount: 1000, rate: goal.insights!.rateToBase }));
  });

  it('converts plannedMonthly to base and paces the ETA by it', async () => {
    const goal = await helpers.createGoal({
      payload: {
        accounts: [{ accountId: (await createAccount()).id, sharePercent: 100 }],
        currencyCode: 'EUR',
        targetAmount: 1000,
        plannedMonthly: 300,
      },
      raw: true,
    });
    const insights = goal.insights!;

    expect(insights.rateToBase).not.toBe(1);
    expect(insights.input.plannedMonthly).toBe(toBaseDecimal({ amount: 300, rate: insights.rateToBase }));
    expect(insights).toMatchObject({ pace: insights.input.plannedMonthly, etaMonths: 4 });
  });

  it('reports no_accounts once the only account is deleted', async () => {
    const account = await createAccount({ initialBalance: 100 });
    const goal = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 100 }] },
      raw: true,
    });

    await helpers.deleteAccount({ id: account.id, raw: true });

    const { insights } = await helpers.getGoal({ goalId: goal.id, raw: true });
    expect(insights).toMatchObject({ status: 'no_accounts', currentValue: 0 });
  });

  it('nulls the insights of a goal without a rate, keeps other goals and its writes working', async () => {
    const account = await createAccount({ initialBalance: 1000 });
    const local = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 50 }] },
      raw: true,
    });
    const euro = await helpers.createGoal({
      payload: { accounts: [{ accountId: account.id, sharePercent: 40 }], currencyCode: 'EUR' },
      raw: true,
    });

    // ExchangeRates is a seed table shared across tests on this worker: snapshot and restore it.
    const [eurRates] = (await connection.sequelize.query(
      `SELECT "baseCode", "quoteCode", "date", "rate", "source"
       FROM "ExchangeRates" WHERE "quoteCode" = 'EUR' OR "baseCode" = 'EUR'`,
    )) as [Array<Record<string, unknown>>, unknown];

    try {
      await connection.sequelize.query(`DELETE FROM "ExchangeRates" WHERE "quoteCode" = 'EUR' OR "baseCode" = 'EUR'`);
      await redisClient.del(`cross_rate:${new Date().toISOString().slice(0, 10)}:EUR:${global.BASE_CURRENCY.code}`);

      const byId = new Map((await helpers.listGoals({ raw: true })).map((goal) => [goal.id, goal]));
      expect(byId.get(euro.id)!.insights).toBeNull();
      expect(byId.get(local.id)!.insights).toMatchObject({ currentValue: 500 });

      const renamed = await helpers.updateGoal({
        goalId: euro.id,
        payload: { name: 'Euro trip', currencyCode: 'EUR' },
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.body.response).toMatchObject({ name: 'Euro trip', currencyCode: 'EUR', insights: null });

      const archived = await helpers.updateGoal({ goalId: euro.id, payload: { status: 'archived' }, raw: true });
      expect(archived).toMatchObject({ status: 'archived', insights: null });

      const created = await helpers.createGoal({
        payload: { accounts: [{ accountId: account.id, sharePercent: 10 }], currencyCode: 'EUR' },
      });
      expect(created.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((created.body.response as unknown as ErrorResponse).code).toBe(
        API_ERROR_CODES.goalCurrencyRateUnavailable,
      );

      const switched = await helpers.updateGoal({ goalId: local.id, payload: { currencyCode: 'EUR' } });
      expect(switched.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((switched.body.response as unknown as ErrorResponse).code).toBe(
        API_ERROR_CODES.goalCurrencyRateUnavailable,
      );
      expect((await helpers.getGoal({ goalId: local.id, raw: true })).currencyCode).toBe(global.BASE_CURRENCY.code);
    } finally {
      for (const row of eurRates) {
        await connection.sequelize.query(
          `INSERT INTO "ExchangeRates" ("baseCode", "quoteCode", "date", "rate", "source")
           VALUES (:baseCode, :quoteCode, :date, :rate, :source)`,
          { replacements: row },
        );
      }
    }
  });
});

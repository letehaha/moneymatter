import { type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { afterEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays, eachDayOfInterval, format, startOfDay, subDays } from 'date-fns';

/**
 * A day's stored balance for a non-base-currency account is the foreign units held
 * that day valued at THAT day's rate, never a running sum of per-transaction rates.
 */

const TODAY = startOfDay(new Date());
const YESTERDAY = subDays(TODAY, 1);
const DEPOSIT_DATE = subDays(TODAY, 90);
const LATER_DATE = subDays(TODAY, 45);
const SEEDED_DATES = [DEPOSIT_DATE, LATER_DATE, YESTERDAY, TODAY];

const HOLDINGS_INR = 100_000;
const HOLDINGS_INR_CENTS = HOLDINGS_INR * 100;

const seedRates = () =>
  helpers.seedInrAedRates({ depositDate: DEPOSIT_DATE, laterDates: [LATER_DATE, YESTERDAY, TODAY] });

const createInrAccount = async () => {
  await helpers.addUserCurrencies({ currencyCodes: ['INR'] });
  return helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: 'INR' }),
    raw: true,
  });
};

const depositHoldings = ({ accountId }: { accountId: RecordId }) =>
  helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount: HOLDINGS_INR,
      transactionType: TRANSACTION_TYPES.income,
      time: DEPOSIT_DATE.toISOString(),
    }),
    raw: true,
  });

describe('Balance history for foreign-currency accounts', () => {
  afterEach(async () => {
    await helpers.clearExchangeRatesForDates({ dates: SEEDED_DATES });
  });

  it('values each historical day at that day’s rate, with no cliff at today, and zeroes out once drained', async () => {
    await seedRates();
    const account = await createInrAccount();

    await depositHoldings({ accountId: account.id });

    const rows = await helpers.getBalanceHistory({ accountId: account.id, raw: true });

    expect(helpers.balanceOn({ rows, date: DEPOSIT_DATE })).toEqualRefValue(
      (HOLDINGS_INR_CENTS / 100) * helpers.INR_TO_AED_AT_DEPOSIT,
    );
    expect(helpers.balanceOn({ rows, date: LATER_DATE })).toEqualRefValue(
      (HOLDINGS_INR_CENTS / 100) * helpers.INR_TO_AED_AFTER,
    );
    expect(helpers.balanceOn({ rows, date: TODAY })).toEqualRefValue(
      (HOLDINGS_INR_CENTS / 100) * helpers.INR_TO_AED_AFTER,
    );
    expect(helpers.balanceCentsOn({ rows, date: YESTERDAY })).toBe(helpers.balanceCentsOn({ rows, date: TODAY }));

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: HOLDINGS_INR,
        transactionType: TRANSACTION_TYPES.expense,
        time: LATER_DATE.toISOString(),
      }),
      raw: true,
    });

    const drainedRows = await helpers.getBalanceHistory({ accountId: account.id, raw: true });

    const nonZeroDays = eachDayOfInterval({ start: LATER_DATE, end: TODAY })
      .filter((date) => helpers.balanceCentsOn({ rows: drainedRows, date }) !== 0)
      .map((date) => format(date, 'yyyy-MM-dd'));

    expect(nonZeroDays).toEqual([]);
  }, 60_000);
});

describe('Balance history for a single account — cross-user access', () => {
  // A window entirely after every stored balance forces the "no rows in range" fallback
  // branch, which is where the missing user scope leaked another account's balance.
  const FUTURE_FROM = format(addDays(TODAY, 365), 'yyyy-MM-dd');
  const FUTURE_TO = format(addDays(TODAY, 366), 'yyyy-MM-dd');
  const INITIAL_BALANCE = 1000;

  it('returns the owner their own balance through the fallback window and leaks nothing to anyone else', async () => {
    const ownerAccount = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: INITIAL_BALANCE }),
      raw: true,
    });

    const rows = await helpers.getBalanceHistory({
      accountId: ownerAccount.id,
      from: FUTURE_FROM,
      to: FUTURE_TO,
      raw: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.amount).toBe(INITIAL_BALANCE);

    const attacker = await helpers.provisionSecondUserWithBaseCurrency();

    const leaked = await helpers.asUser({
      cookies: attacker.cookies,
      fn: () => helpers.getBalanceHistory({ accountId: ownerAccount.id, from: FUTURE_FROM, to: FUTURE_TO, raw: true }),
    });

    expect(leaked).toEqual([]);
  }, 60_000);
});

import { TRANSACTION_TYPES } from '@bt/shared/types';
import { afterEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { startOfDay, subDays } from 'date-fns';

const TODAY = startOfDay(new Date());
const DEPOSIT_DATE = subDays(TODAY, 60);
const MID_DATE = subDays(TODAY, 30);
const SEEDED_DATES = [DEPOSIT_DATE, MID_DATE, TODAY];

const DEPOSIT_INR = 100_000;
const ADDED_OPENING_INR = 50_000;
const HELD_AFTER_EDIT_CENTS = (DEPOSIT_INR + ADDED_OPENING_INR) * 100;

const seedMarketRates = () => helpers.seedInrAedRates({ depositDate: DEPOSIT_DATE, laterDates: [MID_DATE, TODAY] });

describe('Editing the opening balance of a foreign-currency account', () => {
  afterEach(async () => {
    await helpers.clearExchangeRatesForDates({ dates: SEEDED_DATES });
  });

  it('re-prices every stored day at that day’s rate, not by a flat diff', async () => {
    await seedMarketRates();
    await helpers.addUserCurrencies({ currencyCodes: ['INR'] });

    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'INR' }),
      raw: true,
    });

    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: DEPOSIT_INR,
        transactionType: TRANSACTION_TYPES.income,
        time: DEPOSIT_DATE.toISOString(),
      }),
      raw: true,
    });

    // No adjustment transaction: the diff is absorbed into the opening balance,
    // so every day of the history now holds 50,000 more rupees.
    await helpers.updateAccount({
      id: account.id,
      payload: { currentBalance: DEPOSIT_INR + ADDED_OPENING_INR },
      raw: true,
    });

    const rows = await helpers.getBalanceHistory({ accountId: account.id, raw: true });

    expect(helpers.balanceOn({ rows, date: DEPOSIT_DATE })).toEqualRefValue(
      (HELD_AFTER_EDIT_CENTS / 100) * helpers.INR_TO_AED_AT_DEPOSIT,
    );
    expect(helpers.balanceOn({ rows, date: MID_DATE })).toEqualRefValue(
      (HELD_AFTER_EDIT_CENTS / 100) * helpers.INR_TO_AED_AFTER,
    );
    expect(helpers.balanceOn({ rows, date: TODAY })).toEqualRefValue(
      (HELD_AFTER_EDIT_CENTS / 100) * helpers.INR_TO_AED_AFTER,
    );
  });
});

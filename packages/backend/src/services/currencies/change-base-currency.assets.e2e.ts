import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  LOAN_TYPE,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTION_TYPES,
  VEHICLE_CLASS,
} from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Accounts from '@models/accounts.model';
import { connection } from '@models/index';
import * as helpers from '@tests/helpers';
import { format, startOfDay, subDays, subYears } from 'date-fns';

const changeBaseTo = (newCurrencyCode: string) => helpers.changeBaseCurrencyAndWait({ newCurrencyCode });

const pastDate = ({ yearsAgo }: { yearsAgo: number }) => format(subYears(new Date(), yearsAgo), 'yyyy-MM-dd');

const pinBaseToGbpWithEurAndUsd = async () => {
  await helpers.makeRequest({
    method: 'post',
    url: '/user/currencies/base',
    payload: { currencyCode: 'GBP' },
  });
  await helpers.addUserCurrencies({ currencyCodes: ['EUR', 'USD'], raw: true });
};

/**
 * A loan carries its own currency on the underlying Account (`accountCategory: loan`).
 * Changing the user's base currency must recalculate the loan's `ref*` amounts into the
 * new base but must NEVER rewrite the loan's own `currencyCode` — a EUR mortgage stays a
 * EUR mortgage no matter what the user's base currency is. These tests lock that contract
 * in so a future change to `recalculateAccounts` can't silently re-denominate loans.
 */
describe('Change Base Currency — loans keep their own currency', () => {
  beforeEach(pinBaseToGbpWithEurAndUsd);

  it('recalculates ref amounts while leaving every loan on its own currency', async () => {
    const [eurLoan, usdLoan, gbpLoan] = await Promise.all([
      // Loan in EUR, distinct from both the old base (GBP) and the new base (USD).
      helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          name: 'EUR mortgage',
          currencyCode: 'EUR',
          initialBalance: 200_000,
          originalPrincipal: 200_000,
          loanType: LOAN_TYPE.mortgage,
        }),
        raw: true,
      }),
      // Loan in USD, which is exactly the currency the user switches into.
      helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          name: 'USD auto loan',
          currencyCode: 'USD',
          initialBalance: 30_000,
          originalPrincipal: 30_000,
          loanType: LOAN_TYPE.auto,
        }),
        raw: true,
      }),
      helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({ name: 'GBP loan', currencyCode: 'GBP' }),
        raw: true,
      }),
    ]);

    // Snapshot the nominal (own-currency) figures that must survive the change untouched.
    const originalCurrencyCode = eurLoan.currencyCode;
    const originalCurrentBalance = eurLoan.currentBalance;
    const originalOriginalPrincipal = eurLoan.loanDetails.originalPrincipal;

    // Snapshot the ref* figures (in the OLD base, GBP) that must be recalculated into USD.
    const refPlannedPaymentBefore = eurLoan.loanDetails.refPlannedPayment;
    const refOriginalPrincipalBefore = eurLoan.loanDetails.refOriginalPrincipal;
    const refMinPaymentBefore = eurLoan.loanDetails.refMinPayment;

    const eurAccountBefore = await Accounts.findByPk(eurLoan.id, { raw: true });
    const refInitialBalanceBefore = eurAccountBefore!.refInitialBalance;

    const status = await changeBaseTo('USD');
    helpers.expectBaseCurrencyChangeCompleted(status);
    expect(status.result.loanDetailsUpdated).toBeGreaterThan(0);

    // Base currency actually flipped.
    const newBaseCurrency = (await helpers.getUserCurrencies()).find((i) => i.isDefaultCurrency)!;
    expect(newBaseCurrency.currencyCode).toEqual('USD');

    const [eurAfter, usdAfter, gbpAfter] = await Promise.all([
      helpers.getLoanById({ id: eurLoan.id, raw: true }),
      helpers.getLoanById({ id: usdLoan.id, raw: true }),
      helpers.getLoanById({ id: gbpLoan.id, raw: true }),
    ]);

    // The EUR loan still reports EUR — both through the API and on the raw account row.
    expect(eurAfter.currencyCode).toEqual('EUR');
    expect(eurAfter.currencyCode).toEqual(originalCurrencyCode);
    expect(eurAfter.accountCategory).toEqual(ACCOUNT_CATEGORIES.loan);

    const eurAccountAfter = await Accounts.findByPk(eurLoan.id, { raw: true });
    expect(eurAccountAfter!.currencyCode).toEqual('EUR');
    expect(eurAccountAfter!.type).toEqual(ACCOUNT_TYPES.system);

    // Nominal own-currency figures are preserved.
    expect(eurAfter.currentBalance).toEqual(originalCurrentBalance);
    expect(eurAfter.loanDetails.originalPrincipal).toEqual(originalOriginalPrincipal);

    // The ref balance WAS recalculated into the new base (EUR→USD rate differs from EUR→GBP).
    expect(eurAccountAfter!.refInitialBalance).not.toEqual(refInitialBalanceBefore);

    // LoanDetails ref* copies (read by the base-currency aggregates on /loans) were
    // recalculated too — otherwise the monthly-obligation total keeps the old base value.
    expect(eurAfter.loanDetails.refPlannedPayment).not.toEqual(refPlannedPaymentBefore);
    expect(eurAfter.loanDetails.refOriginalPrincipal).not.toEqual(refOriginalPrincipalBefore);
    expect(eurAfter.loanDetails.refMinPayment).not.toEqual(refMinPaymentBefore);
    // Nominal payment figures stay in the loan's own currency (EUR), untouched.
    expect(eurAfter.loanDetails.plannedPayment).toEqual(eurLoan.loanDetails.plannedPayment);

    expect(usdAfter.currencyCode).toEqual('USD');

    // Now that USD is the base, that loan's ref amounts equal its nominal amounts 1:1.
    const usdAccountAfter = await Accounts.findByPk(usdLoan.id, { raw: true });
    expect(usdAccountAfter!.refInitialBalance).toEqual(usdAccountAfter!.initialBalance);
    expect(usdAfter.loanDetails.refOriginalPrincipal).toEqual(usdAfter.loanDetails.originalPrincipal);
    expect(usdAfter.loanDetails.refPlannedPayment).toEqual(usdAfter.loanDetails.plannedPayment);
    expect(usdAfter.loanDetails.refMinPayment).toEqual(usdAfter.loanDetails.minPayment);

    // A loan on the outgoing base currency is left alone too.
    expect(gbpAfter.currencyCode).toEqual('GBP');
  }, 30000);
});

/**
 * A vehicle carries its own currency on the underlying Account (`accountCategory: vehicle`)
 * and, unlike cash/loan system accounts, its balance is a directly-maintained depreciating
 * value with no backing transactions. Changing the base currency must recalculate the
 * vehicle's `ref*` amounts into the new base WITHOUT re-denominating the loan currency and
 * WITHOUT snapping the current value back to the creation-time figure (which would drop
 * accrued depreciation). These tests lock both in.
 */
describe('Change Base Currency — vehicles', () => {
  beforeEach(pinBaseToGbpWithEurAndUsd);

  it('keeps a vehicle on its own currency and preserves its depreciated value', async () => {
    const camry = await helpers.createVehicle({
      name: 'EUR Camry',
      currencyCode: 'EUR',
      make: 'Toyota',
      model: 'Camry',
      year: 2020,
      vehicleClass: VEHICLE_CLASS.sedan,
      purchasePrice: 25_000,
      purchaseDate: pastDate({ yearsAgo: 3 }),
      raw: true,
    });

    // Vehicle with its current value overridden below the creation value. Vehicles carry
    // no transactions, so a transaction-sum derivation would collapse refCurrentBalance
    // back to the higher refInitialBalance on a base switch.
    const suv = await helpers.createVehicle({
      name: 'EUR SUV',
      currencyCode: 'EUR',
      make: 'Toyota',
      model: 'RAV4',
      year: 2019,
      vehicleClass: VEHICLE_CLASS.sedan,
      purchasePrice: 25_000,
      purchaseDate: pastDate({ yearsAgo: 3 }),
      raw: true,
    });

    // Drive the SUV's current value down to 5,000 EUR.
    await helpers.overrideVehicleValue({ id: suv.id, accountId: suv.accountId, targetValue: 5_000 });

    const [camryBefore, suvBefore] = await Promise.all([
      Accounts.findByPk(camry.accountId),
      Accounts.findByPk(suv.accountId),
    ]);
    const camryCurrentBefore = camryBefore!.currentBalance.toNumber();
    const camryRefCurrentBefore = camryBefore!.refCurrentBalance!.toNumber();
    const suvCurrentBefore = suvBefore!.currentBalance.toNumber();
    const suvInitialBefore = suvBefore!.initialBalance.toNumber();

    // Precondition: current value now sits below the frozen creation (initial) value.
    expect(suvCurrentBefore).toBeLessThan(suvInitialBefore);
    expect(suvBefore!.refCurrentBalance!.toNumber()).toBeLessThan(suvBefore!.refInitialBalance!.toNumber());

    const status = await changeBaseTo('USD');
    helpers.expectBaseCurrencyChangeCompleted(status);

    const [camryAfter, suvAfter] = await Promise.all([
      Accounts.findByPk(camry.accountId),
      Accounts.findByPk(suv.accountId),
    ]);

    // Currency untouched; still a vehicle system account.
    expect(camryAfter!.currencyCode).toEqual('EUR');
    expect(camryAfter!.accountCategory).toEqual(ACCOUNT_CATEGORIES.vehicle);
    expect(camryAfter!.type).toEqual(ACCOUNT_TYPES.system);
    // Nominal value preserved, ref value recalculated into the new base.
    expect(camryAfter!.currentBalance.toNumber()).toEqual(camryCurrentBefore);
    expect(camryAfter!.refCurrentBalance!.toNumber()).not.toEqual(camryRefCurrentBefore);

    // Nominal figures untouched on the depreciated vehicle.
    expect(suvAfter!.currencyCode).toEqual('EUR');
    expect(suvAfter!.currentBalance.toNumber()).toEqual(suvCurrentBefore);
    expect(suvAfter!.initialBalance.toNumber()).toEqual(suvInitialBefore);

    // refCurrentBalance must keep the depreciated value; snapping up to the creation-time
    // refInitialBalance is the failure this guards. currentBalance < initialBalance with
    // the same EUR→USD rate on both, so the ref values stay strictly ordered.
    const refCurrentAfter = suvAfter!.refCurrentBalance!.toNumber();
    const refInitialAfter = suvAfter!.refInitialBalance!.toNumber();
    expect(refCurrentAfter).not.toEqual(refInitialAfter);
    expect(refCurrentAfter).toBeLessThan(refInitialAfter);
  }, 30000);
});

/**
 * The ledger-boundary (earliest-transaction) rate that `recalculateAccounts` uses to
 * restamp `refInitialBalance` on a base-currency change must be resolved by
 * `accountId`, NOT by the transaction AUTHOR's `userId`. On a shared account a
 * recipient with `write` permission creates rows under their own userId, so an
 * author-scoped boundary query drops a recipient-authored earliest row, picks a
 * later boundary, and diverges from `restampRefInitialBalance` (which is
 * account-scoped) — the next transaction write then restamps a different value and
 * re-baselines the whole Balances history.
 *
 * The change-base guard blocks the switch while a share is active, so the reachable
 * window is: recipient authors the earliest row, the share is revoked (recipient
 * rows survive), then the owner changes base.
 */

// Five days back, with its own EUR/AED rates so the boundary-date conversion differs
// sharply from today's basket. EUR→USD historical = 1 / 0.5 = 2.0.
const HISTORICAL_DATE = subDays(startOfDay(new Date()), 5);
const HISTORICAL_EUR_PER_USD = 0.5;
const HISTORICAL_AED_PER_USD = 3.5;
const HISTORICAL_EUR_TO_USD = 1 / HISTORICAL_EUR_PER_USD; // 2.0

const decimalToCents = (decimal: unknown) => Math.round(Number(decimal) * 100);

const seedHistoricalRates = async () => {
  // ExchangeRates is keyed on (baseCode, quoteCode, date) and is not truncated between tests, so
  // clear this date first — another file seeding the same fixture would make the insert throw.
  await connection.sequelize.query(`DELETE FROM "ExchangeRates" WHERE date = :date`, {
    replacements: { date: HISTORICAL_DATE },
  });

  await connection.sequelize.query(
    `INSERT INTO "ExchangeRates" ("baseCode", "quoteCode", "date", "rate", "source")
     VALUES ('USD', 'EUR', :date, :eurRate, 'api-layer'), ('USD', 'AED', :date, :aedRate, 'api-layer')`,
    {
      replacements: { date: HISTORICAL_DATE, eurRate: HISTORICAL_EUR_PER_USD, aedRate: HISTORICAL_AED_PER_USD },
    },
  );
};

describe('Change base currency — shared-account ledger boundary is author-blind', () => {
  afterEach(async () => {
    await connection.sequelize.query(`DELETE FROM "ExchangeRates" WHERE date = :date`, {
      replacements: { date: HISTORICAL_DATE },
    });
  });

  it('restamps refInitialBalance at a recipient-authored earliest transaction’s boundary date, and a later owner write does not re-baseline it', async () => {
    // Owner (primary user, base AED). Connect EUR (the account currency) and USD
    // (the change-base target).
    await helpers.addUserCurrencies({ currencyCodes: ['EUR', 'USD'] });

    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'EUR', initialBalance: 200 }),
      raw: true,
    });

    // Recipient defaults to the same base (AED) — the accept guard requires it — and
    // connects EUR so their transaction can convert.
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();

    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.account,
      resourceId: account.id,
      permission: SHARE_PERMISSIONS.write,
      raw: true,
    });
    const acceptRes = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: false }),
    });
    expect(acceptRes.statusCode).toBe(200);

    // Rates for the boundary date must exist before the backdated write lands.
    await seedHistoricalRates();

    // The RECIPIENT authors the earliest transaction on the owner's account — its
    // row carries the recipient's userId, so an author-scoped boundary query would
    // never see it.
    const recipientTx = await helpers.asUser({
      cookies: recipient.cookies,
      fn: async () => {
        await helpers.addUserCurrencies({ currencyCodes: ['EUR'] });
        return helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            transactionType: TRANSACTION_TYPES.income,
            time: HISTORICAL_DATE.toISOString(),
          }),
          raw: false,
        });
      },
    });
    expect(recipientTx.statusCode).toBe(200);

    // Revoke the share so the change-base guard lets the switch through. The
    // recipient's transaction row stays on the owner's account (only account-type
    // transfers are converted on revoke; a plain income row is untouched).
    const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });
    await helpers.revokeShareMember({
      resourceType: RESOURCE_TYPES.account,
      resourceId: account.id,
      memberUserId: recipientApp.id,
      raw: true,
    });

    // Owner switches base AED → USD.
    const changeStatus = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'USD' });
    helpers.expectBaseCurrencyChangeCompleted(changeStatus);

    // refInitialBalance = opening 200 EUR × EUR→USD at the recipient tx's boundary
    // date (2.0) = 400 USD. The boundary is account-scoped (not author-scoped),
    // matching `restampRefInitialBalance`, so a recipient-authored earliest tx sets it.
    const afterChange = await helpers.getAccount({ id: account.id, raw: true });
    expect(decimalToCents(afterChange.refInitialBalance)).toEqualRefValue(20000 * HISTORICAL_EUR_TO_USD);

    // A subsequent owner-authored write triggers the account-scoped restamp. Because
    // change-base used the same boundary, refInitialBalance must NOT move — it stays
    // the boundary-rate value in the new base (400 USD), and the ref-amount cache
    // (keyed on the resolved quote currency) can't re-serve the pre-change AED entry.
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 10,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    const afterOwnerWrite = await helpers.getAccount({ id: account.id, raw: true });
    expect(decimalToCents(afterOwnerWrite.refInitialBalance)).toEqualRefValue(20000 * HISTORICAL_EUR_TO_USD);
  });
});

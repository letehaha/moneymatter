import {
  ACCOUNT_TYPES,
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_PERIOD_STATUSES,
  SUBSCRIPTION_TYPES,
  TRANSACTION_TYPES,
  type RecordId,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { addDays, addMonths, format } from 'date-fns';

/** Returns a date string N months from today, on the given day-of-month. */
function futureDate({ monthsAhead, day }: { monthsAhead: number; day: number }): string {
  const d = addMonths(new Date(), monthsAhead);
  d.setDate(day);
  return format(d, 'yyyy-MM-dd');
}

/**
 * Seeds a UAH account with a USD subscription so the billed currency differs
 * from the account currency. The test environment ships exchange rates for all
 * currency pairs that appear in `global.MODELS_CURRENCIES`, so USD→UAH
 * conversion is available out of the box — the same pattern used in
 * scheduled-payments.e2e.ts.
 */
async function createUsdSubOnUahAccount({ expectedAmount }: { expectedAmount: number }) {
  const uah = global.MODELS_CURRENCIES!.find((c) => c.code === 'UAH')!;
  await helpers.addUserCurrencies({ currencyCodes: [uah.code] });
  const account = await helpers.createAccount({
    payload: { ...helpers.buildAccountPayload(), currencyCode: uah.code },
    raw: true,
  });
  const sub = await helpers.createSubscription({
    name: 'USD Subscription',
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: futureDate({ monthsAhead: 1, day: 1 }),
    dueDate: futureDate({ monthsAhead: 1, day: 1 }),
    accountId: account.id,
    categoryId: global.DEFAULT_CATEGORY_ID,
    expectedAmount,
    expectedCurrencyCode: global.BASE_CURRENCY.code,
    raw: true,
  });
  return { account, sub, accountCurrencyCode: uah.code };
}

describe('POST /subscriptions/:id/periods/:periodId/pay', () => {
  describe('Same-currency create-mode', () => {
    it('books an expense for a recurring expense and an income for a recurring income, advancing the schedule', async () => {
      const account = await helpers.createAccount({ raw: true });
      const expenseSub = await helpers.createSubscription({
        name: 'Netflix',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        accountId: account.id,
        categoryId: global.DEFAULT_CATEGORY_ID,
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });
      const incomeSub = await helpers.createSubscription({
        name: 'Paycheck',
        transactionType: TRANSACTION_TYPES.income,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        accountId: account.id,
        categoryId: global.DEFAULT_CATEGORY_ID,
        expectedAmount: 2500,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });

      const expenseDetail = await helpers.getSubscriptionById({ id: expenseSub.id, raw: true });
      const expensePeriod = expenseDetail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
      expect(expensePeriod).toBeDefined();

      const paidExpense = await helpers.markSubscriptionPeriodPaid({
        id: expenseSub.id,
        periodId: expensePeriod!.id,
        createTransaction: true,
        raw: true,
      });

      expect(paidExpense.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
      expect(paidExpense.transactionAutoCreated).toBe(true);
      expect(paidExpense.transactionId).toBeTruthy();

      const afterExpense = await helpers.getSubscriptionById({ id: expenseSub.id, raw: true });
      const nextUpcoming = afterExpense.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
      expect(nextUpcoming).toBeDefined();
      const paidDue = new Date(expensePeriod!.dueDate + 'T00:00:00Z');
      expect(nextUpcoming!.dueDate).toBe(format(addMonths(paidDue, 1), 'yyyy-MM-dd'));

      const expenseTx = await helpers.getTransactionById({ id: paidExpense.transactionId!, raw: true });
      expect(expenseTx).not.toBeNull();
      expect(expenseTx!.transactionType).toBe(TRANSACTION_TYPES.expense);
      expect(expenseTx!.accountId).toBe(account.id);
      expect(expenseTx!.amount).toBe(10);

      const incomeDetail = await helpers.getSubscriptionById({ id: incomeSub.id, raw: true });
      const incomePeriod = incomeDetail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
      expect(incomePeriod).toBeDefined();

      const paidIncome = await helpers.markSubscriptionPeriodPaid({
        id: incomeSub.id,
        periodId: incomePeriod!.id,
        createTransaction: true,
        raw: true,
      });

      expect(paidIncome.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
      expect(paidIncome.transactionAutoCreated).toBe(true);
      expect(paidIncome.transactionId).toBeTruthy();

      const incomeTx = await helpers.getTransactionById({ id: paidIncome.transactionId!, raw: true });
      expect(incomeTx).not.toBeNull();
      expect(incomeTx!.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(incomeTx!.accountId).toBe(account.id);
      expect(incomeTx!.amount).toBe(2500);
    }, 60_000);
  });

  describe('Cross-currency invariant', () => {
    it('books the converted UAH amount and preview matches the booking', async () => {
      const { account, sub, accountCurrencyCode } = await createUsdSubOnUahAccount({ expectedAmount: 10 });

      // GET pay-preview: must report cross-currency.
      const preview = await helpers.getSubscriptionPayPreview({ id: sub.id, raw: true });
      expect(preview.isCrossCurrency).toBe(true);
      expect(preview.accountCurrencyCode).toBe(accountCurrencyCode);
      expect(preview.subscriptionCurrencyCode).toBe(global.BASE_CURRENCY.code);
      expect(preview.expectedAmount).toBe(10);
      expect(preview.convertedAmount).not.toBeNull();
      // UAH converted value should differ from the USD nominal.
      expect(preview.convertedAmount).not.toBe(10);

      // POST pay with no override: booked amount must equal preview.convertedAmount.
      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const upcoming = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      const paidPeriod = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: upcoming!.id,
        createTransaction: true,
        raw: true,
      });

      const tx = await helpers.getTransactionById({ id: paidPeriod.transactionId!, raw: true });
      expect(tx).not.toBeNull();
      // Booked in the account's currency (UAH), not the subscription's billed currency (USD).
      expect(tx!.currencyCode).toBe(accountCurrencyCode);
      expect(tx!.accountId).toBe(account.id);
      // The booked amount must exactly match the previewed estimate.
      expect(tx!.amount).toBe(preview.convertedAmount);
    });
  });

  describe('Amount override', () => {
    it('books the explicit override amount verbatim', async () => {
      const account = await helpers.createAccount({ raw: true });
      const sub = await helpers.createSubscription({
        name: 'Power Bill',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        accountId: account.id,
        categoryId: global.DEFAULT_CATEGORY_ID,
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const upcoming = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      const period = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: upcoming!.id,
        createTransaction: true,
        amount: 425.5,
        raw: true,
      });

      const tx = await helpers.getTransactionById({ id: period.transactionId!, raw: true });
      expect(tx!.amount).toBe(425.5);
    });
  });

  describe('Link-mode (existing transaction)', () => {
    it('links the caller-supplied transaction without creating a new one', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [existingTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const sub = await helpers.createSubscription({
        name: 'Rent',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        accountId: account.id,
        categoryId: global.DEFAULT_CATEGORY_ID,
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const upcoming = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      const period = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: upcoming!.id,
        transactionId: existingTx!.id,
        raw: true,
      });

      expect(period.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
      expect(period.transactionId).toBe(existingTx!.id);
      // Link-mode never sets the auto-created flag.
      expect(period.transactionAutoCreated).toBe(false);
    });

    it('rejects a planned transaction and leaves the period upcoming', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [planned] = await helpers.createPlannedTransaction({
        payload: {
          accountId: account.id,
          amount: 10,
          time: addMonths(new Date(), 1).toISOString(),
        },
        raw: true,
      });

      const sub = await helpers.createSubscription({
        name: 'Gym',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        accountId: account.id,
        categoryId: global.DEFAULT_CATEGORY_ID,
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const upcoming = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      const res = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: upcoming!.id,
        transactionId: planned!.id,
        raw: false,
      });
      expect(res.statusCode).toBe(422);

      const after = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const period = after.periods.find((p) => p.id === upcoming!.id);
      expect(period!.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.upcoming);
      expect(period!.transactionId).toBeNull();
    });
  });

  describe('Variable bill (no expectedAmount)', () => {
    it('rejects create-mode when no expectedAmount and no override is given', async () => {
      const account = await helpers.createAccount({ raw: true });
      const sub = await helpers.createSubscription({
        name: 'Gas Bill',
        type: SUBSCRIPTION_TYPES.bill,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        accountId: account.id,
        // no expectedAmount — variable amount bill
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const upcoming = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      const res = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: upcoming!.id,
        createTransaction: true,
        raw: false,
      });
      expect(res.statusCode).toBe(422);

      // Period remains unpaid.
      const afterDetail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const afterPeriod = afterDetail.periods.find((p) => p.id === upcoming!.id);
      expect(afterPeriod!.status).not.toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    });

    it('succeeds when a variable-amount bill is paid with an explicit override', async () => {
      const account = await helpers.createAccount({ raw: true });
      const sub = await helpers.createSubscription({
        name: 'Water Bill',
        type: SUBSCRIPTION_TYPES.bill,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        accountId: account.id,
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const upcoming = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      const period = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: upcoming!.id,
        createTransaction: true,
        amount: 50,
        raw: true,
      });

      expect(period.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
      const tx = await helpers.getTransactionById({ id: period.transactionId!, raw: true });
      expect(tx!.amount).toBe(50);
    });
  });

  describe('Pay-time account selection (account-less subscription)', () => {
    it('links the chosen account, books the expense against it, and advances the schedule', async () => {
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });

      const sub = await helpers.createSubscription({
        name: 'Phone installment',
        type: SUBSCRIPTION_TYPES.installment,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 15 }),
        dueDate: futureDate({ monthsAhead: 1, day: 15 }),
        categoryId: global.DEFAULT_CATEGORY_ID,
        expectedAmount: 90,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        maxOccurrences: 12,
        raw: true,
      });
      expect(sub.accountId).toBeNull();

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const upcoming = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      const period = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: upcoming!.id,
        createTransaction: true,
        accountId: account.id,
        raw: true,
      });

      expect(period.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
      expect(period.transactionAutoCreated).toBe(true);
      expect(period.transactionId).toBeTruthy();

      const tx = await helpers.getTransactionById({ id: period.transactionId!, raw: true });
      expect(tx).not.toBeNull();
      expect(tx!.transactionType).toBe(TRANSACTION_TYPES.expense);
      expect(tx!.accountId).toBe(account.id);
      expect(tx!.amount).toBe(90);

      const after = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(after.accountId).toBe(account.id);
      const nextUpcoming = after.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
      expect(nextUpcoming).toBeDefined();

      // Second pay passes no accountId: it must reuse the account the first pay linked.
      const secondPaid = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: nextUpcoming!.id,
        createTransaction: true,
        raw: true,
      });
      const secondTx = await helpers.getTransactionById({ id: secondPaid.transactionId!, raw: true });
      expect(secondTx!.accountId).toBe(account.id);
    }, 60_000);

    it('returns 404 and leaves the period unpaid when the chosen account is not the user’s', async () => {
      const sub = await helpers.createSubscription({
        name: 'Account-less plan',
        type: SUBSCRIPTION_TYPES.installment,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 15 }),
        dueDate: futureDate({ monthsAhead: 1, day: 15 }),
        categoryId: global.DEFAULT_CATEGORY_ID,
        expectedAmount: 90,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        maxOccurrences: 12,
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const upcoming = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      const res = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: upcoming!.id,
        createTransaction: true,
        accountId: generateRandomRecordId(),
        raw: false,
      });
      expect(res.statusCode).toBe(404);

      // The failed link rolled back: no account on the subscription, period still open.
      const after = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(after.accountId).toBeNull();
      expect(after.periods.find((p) => p.id === upcoming!.id)!.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.upcoming);
    });
  });

  describe('Error cases', () => {
    it('guards mutually exclusive params, an already-paid period and a skipped period', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const sub = await helpers.createSubscription({
        name: 'Spotify',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        accountId: account.id,
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const first = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      const bothParamsRes = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: first!.id,
        createTransaction: true,
        transactionId: tx!.id,
        raw: false,
      });
      expect(bothParamsRes.statusCode).toBe(422);

      const paid = await helpers.markSubscriptionPeriodPaid({ id: sub.id, periodId: first!.id, raw: true });
      expect(paid.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);

      const rePayRes = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: first!.id,
        raw: false,
      });
      expect(rePayRes.statusCode).toBe(409);

      const afterFirst = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const second = afterFirst.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
      expect(second).toBeDefined();

      const skipped = await helpers.skipSubscriptionPeriod({ id: sub.id, periodId: second!.id, raw: true });
      expect(skipped.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.skipped);

      const paySkippedRes = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: second!.id,
        raw: false,
      });
      expect(paySkippedRes.statusCode).toBe(409);
    }, 60_000);

    it('returns an error when createTransaction is true but the subscription has no account', async () => {
      const sub = await helpers.createSubscription({
        name: 'No Account Sub',
        type: SUBSCRIPTION_TYPES.subscription,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        // no accountId
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const upcoming = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      const res = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: upcoming!.id,
        createTransaction: true,
        raw: false,
      });
      expect(res.statusCode).toBe(422);
    });

    it('rejects create-mode on a bank-connected account but still allows a plain mark-paid', async () => {
      const bankAccount = await helpers.createAccount({
        payload: { ...helpers.buildAccountPayload(), type: ACCOUNT_TYPES.monobank },
        raw: true,
      });
      const linkedSub = await helpers.createSubscription({
        name: 'Bank-linked sub',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        accountId: bankAccount.id,
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });
      const accountlessSub = await helpers.createSubscription({
        name: 'Account-less sub',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });

      const linkedDetail = await helpers.getSubscriptionById({ id: linkedSub.id, raw: true });
      const linkedPeriod = linkedDetail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
      const accountlessDetail = await helpers.getSubscriptionById({ id: accountlessSub.id, raw: true });
      const accountlessPeriod = accountlessDetail.periods.find(
        (p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming,
      );

      const linkedRes = await helpers.markSubscriptionPeriodPaid({
        id: linkedSub.id,
        periodId: linkedPeriod!.id,
        createTransaction: true,
        raw: false,
      });
      expect(linkedRes.statusCode).toBe(ERROR_CODES.ValidationError);

      const pickedRes = await helpers.markSubscriptionPeriodPaid({
        id: accountlessSub.id,
        periodId: accountlessPeriod!.id,
        createTransaction: true,
        accountId: bankAccount.id,
        amount: 10,
        raw: false,
      });
      expect(pickedRes.statusCode).toBe(ERROR_CODES.ValidationError);

      const accountlessAfter = await helpers.getSubscriptionById({ id: accountlessSub.id, raw: true });
      expect(accountlessAfter.accountId).toBeNull();
      expect(accountlessAfter.periods.find((p) => p.id === accountlessPeriod!.id)!.status).toBe(
        SUBSCRIPTION_PERIOD_STATUSES.upcoming,
      );

      const txs = await helpers.getTransactions({ raw: true });
      expect(txs.filter((tx) => tx.accountId === bankAccount.id)).toEqual([]);

      const markedOnly = await helpers.markSubscriptionPeriodPaid({
        id: linkedSub.id,
        periodId: linkedPeriod!.id,
        raw: true,
      });
      expect(markedOnly.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
      expect(markedOnly.transactionId).toBeNull();
    });

    it('rejects linking the same transaction to a period of a different subscription (422)', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [sharedTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const makeSub = (name: string) =>
        helpers.createSubscription({
          name,
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: futureDate({ monthsAhead: 1, day: 1 }),
          dueDate: futureDate({ monthsAhead: 1, day: 1 }),
          accountId: account.id,
          expectedAmount: 10,
          expectedCurrencyCode: global.BASE_CURRENCY.code,
          raw: true,
        });

      const sub1 = await makeSub('Sub One');
      const sub2 = await makeSub('Sub Two');

      const detail1 = await helpers.getSubscriptionById({ id: sub1.id, raw: true });
      const upcoming1 = detail1.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
      const detail2 = await helpers.getSubscriptionById({ id: sub2.id, raw: true });
      const upcoming2 = detail2.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      // Link the transaction to a period of the first subscription.
      const paid1 = await helpers.markSubscriptionPeriodPaid({
        id: sub1.id,
        periodId: upcoming1!.id,
        transactionId: sharedTx!.id,
        raw: true,
      });
      expect(paid1.transactionId).toBe(sharedTx!.id);

      // Re-using it on a period of the second subscription must be rejected.
      const res = await helpers.markSubscriptionPeriodPaid({
        id: sub2.id,
        periodId: upcoming2!.id,
        transactionId: sharedTx!.id,
        raw: false,
      });
      expect(res.statusCode).toBe(422);

      // The second period stays unpaid and unlinked.
      const after2 = await helpers.getSubscriptionById({ id: sub2.id, raw: true });
      const afterPeriod2 = after2.periods.find((p) => p.id === upcoming2!.id);
      expect(afterPeriod2!.status).not.toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
      expect(afterPeriod2!.transactionId).toBeNull();

      const foreignRes = await helpers.markSubscriptionPeriodPaid({
        id: sub1.id,
        periodId: upcoming2!.id,
        raw: false,
      });
      expect(foreignRes.statusCode).toBe(404);
    });

    it('rejects linking the same transaction to two periods of the same subscription (422)', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [sharedTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      const sub = await helpers.createSubscription({
        name: 'Same Sub Double Link',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        accountId: account.id,
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });

      // Paying the first period generates the next upcoming one, giving two periods to link against.
      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const period1 = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: period1!.id,
        transactionId: sharedTx!.id,
        raw: true,
      });

      const afterFirst = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const period2 = afterFirst.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);
      expect(period2).toBeDefined();

      // Linking the same transaction to the second period must be rejected.
      const res = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: period2!.id,
        transactionId: sharedTx!.id,
        raw: false,
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe('Paid date (backdated payment)', () => {
    it('stamps paidAt with the supplied past time, not today', async () => {
      const account = await helpers.createAccount({ raw: true });
      const sub = await helpers.createSubscription({
        name: 'Backdated Sub',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: futureDate({ monthsAhead: 1, day: 1 }),
        dueDate: futureDate({ monthsAhead: 1, day: 1 }),
        accountId: account.id,
        expectedAmount: 10,
        expectedCurrencyCode: global.BASE_CURRENCY.code,
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      const upcoming = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

      // A fixed past date, two months back, independent of the scheduler.
      const pastDate = futureDate({ monthsAhead: -2, day: 14 });
      const today = format(new Date(), 'yyyy-MM-dd');
      expect(pastDate).not.toBe(today);

      const period = await helpers.markSubscriptionPeriodPaid({
        id: sub.id,
        periodId: upcoming!.id,
        createTransaction: true,
        time: pastDate,
        raw: true,
      });

      expect(period.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
      // paidAt falls on the supplied past date, not today.
      const paidAtDate = format(new Date(period.paidAt!), 'yyyy-MM-dd');
      expect(paidAtDate).toBe(pastDate);
      expect(paidAtDate).not.toBe(today);

      // And it matches the booked transaction's date.
      const tx = await helpers.getTransactionById({ id: period.transactionId!, raw: true });
      const txDate = format(new Date(tx!.time), 'yyyy-MM-dd');
      expect(txDate).toBe(pastDate);
    });
  });
});

describe('GET /subscriptions/:id/pay-preview', () => {
  it('previews same-currency, account-less and amount-less subscriptions', async () => {
    const account = await helpers.createAccount({ raw: true });

    const sameCurrencySub = await helpers.createSubscription({
      name: 'iCloud',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: futureDate({ monthsAhead: 1, day: 1 }),
      dueDate: futureDate({ monthsAhead: 1, day: 1 }),
      accountId: account.id,
      expectedAmount: 20,
      expectedCurrencyCode: global.BASE_CURRENCY.code,
      raw: true,
    });

    const noAccountSub = await helpers.createSubscription({
      name: 'No Account Preview',
      type: SUBSCRIPTION_TYPES.subscription,
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: futureDate({ monthsAhead: 1, day: 1 }),
      dueDate: futureDate({ monthsAhead: 1, day: 1 }),
      expectedAmount: 5,
      expectedCurrencyCode: global.BASE_CURRENCY.code,
      // no accountId
      raw: true,
    });

    // Account in the base currency so same-currency keeps isCrossCurrency false;
    // the missing expectedAmount is what makes convertedAmount null.
    const variableBillSub = await helpers.createSubscription({
      name: 'Variable Bill Preview',
      type: SUBSCRIPTION_TYPES.bill,
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: futureDate({ monthsAhead: 1, day: 1 }),
      dueDate: futureDate({ monthsAhead: 1, day: 1 }),
      accountId: account.id,
      // no expectedAmount — variable-amount bill
      raw: true,
    });

    const sameCurrency = await helpers.getSubscriptionPayPreview({ id: sameCurrencySub.id, raw: true });
    expect(sameCurrency.isCrossCurrency).toBe(false);
    expect(sameCurrency.accountCurrencyCode).toBe(global.BASE_CURRENCY.code);
    expect(sameCurrency.expectedAmount).toBe(20);
    expect(sameCurrency.convertedAmount).toBe(20);

    const noAccount = await helpers.getSubscriptionPayPreview({ id: noAccountSub.id, raw: true });
    expect(noAccount.accountCurrencyCode).toBeNull();
    expect(noAccount.convertedAmount).toBeNull();
    expect(noAccount.expectedAmount).toBe(5);

    const variableBill = await helpers.getSubscriptionPayPreview({ id: variableBillSub.id, raw: true });
    expect(variableBill.accountCurrencyCode).toBe(global.BASE_CURRENCY.code);
    expect(variableBill.isCrossCurrency).toBe(false);
    expect(variableBill.expectedAmount).toBeNull();
    // Nothing to convert without an expectedAmount.
    expect(variableBill.convertedAmount).toBeNull();
  }, 60_000);
});

async function createSubWithOpenPeriod({ accountId, dueDate }: { accountId: RecordId; dueDate: string }) {
  const sub = await helpers.createSubscription({
    name: 'Hand-linked Sub',
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: dueDate,
    dueDate,
    accountId,
    categoryId: global.DEFAULT_CATEGORY_ID,
    expectedAmount: 10,
    expectedCurrencyCode: global.BASE_CURRENCY.code,
    raw: true,
  });
  const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
  const openPeriod = detail.periods.find((p) => p.status !== SUBSCRIPTION_PERIOD_STATUSES.paid)!;
  return { sub, openPeriod };
}

async function createLinkedTx({
  accountId,
  subscriptionId,
  time,
}: {
  accountId: RecordId;
  subscriptionId: string;
  time?: string;
}) {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId, amount: 12.5, ...(time ? { time } : {}) }),
    raw: true,
  });
  await helpers.linkTransactionsToSubscription({ id: subscriptionId, transactionIds: [tx!.id], raw: true });
  return tx!;
}

describe('GET /subscriptions/:id/pay-preview?periodId – linked payments already recorded for the period', () => {
  it('returns a hand-linked payment dated inside the period, with decimal amount', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { sub, openPeriod } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: 0, day: 15 }),
    });
    const tx = await createLinkedTx({ accountId: account.id, subscriptionId: sub.id });

    const preview = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: openPeriod.id, raw: true });
    expect(preview.linkedPayments).toHaveLength(1);
    const candidate = preview.linkedPayments[0]!;
    expect(candidate.id).toBe(tx.id);
    expect(candidate.amount).toBe(12.5);
    expect(candidate.accountId).toBe(account.id);
    expect(candidate.currencyCode).toBe(global.BASE_CURRENCY.code);
    expect(new Date(candidate.time).toISOString()).toBe(new Date(tx.time).toISOString());

    // Without a periodId there is nothing to match against.
    const noPeriod = await helpers.getSubscriptionPayPreview({ id: sub.id, raw: true });
    expect(noPeriod.linkedPayments).toEqual([]);
  });

  it('returns nothing when the transaction is not linked to the subscription', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { sub, openPeriod } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: 1, day: 1 }),
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id }),
      raw: true,
    });

    const preview = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: openPeriod.id, raw: true });
    expect(preview.linkedPayments).toEqual([]);
  });

  it('returns only linked payments dated after the previous period due date', async () => {
    const account = await helpers.createAccount({ raw: true });
    // First period two months back; marking it paid opens the second period one month back.
    const { sub, openPeriod: firstPeriod } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: -2, day: 10 }),
    });
    await helpers.markSubscriptionPeriodPaid({ id: sub.id, periodId: firstPeriod.id, raw: true });
    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    const secondPeriod = detail.periods.find((p) => p.status !== SUBSCRIPTION_PERIOD_STATUSES.paid)!;
    expect(secondPeriod.dueDate).toBe(futureDate({ monthsAhead: -1, day: 10 }));

    const beforeFirstDue = await createLinkedTx({
      accountId: account.id,
      subscriptionId: sub.id,
      time: new Date(futureDate({ monthsAhead: -2, day: 5 }) + 'T12:00:00Z').toISOString(),
    });
    const onFirstDue = await createLinkedTx({
      accountId: account.id,
      subscriptionId: sub.id,
      time: new Date(futureDate({ monthsAhead: -2, day: 10 }) + 'T12:00:00Z').toISOString(),
    });
    const inWindow = await createLinkedTx({
      accountId: account.id,
      subscriptionId: sub.id,
      time: new Date(futureDate({ monthsAhead: -2, day: 20 }) + 'T12:00:00Z').toISOString(),
    });

    const preview = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: secondPeriod.id, raw: true });
    const ids = preview.linkedPayments.map((c) => c.id);
    expect(ids).toEqual([inWindow.id]);
    expect(ids).not.toContain(beforeFirstDue.id);
    expect(ids).not.toContain(onFirstDue.id);
  });

  it('returns nothing when the linked transaction already backs another period', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { sub, openPeriod: firstPeriod } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: -2, day: 10 }),
    });
    const tx = await createLinkedTx({
      accountId: account.id,
      subscriptionId: sub.id,
      time: new Date(futureDate({ monthsAhead: -2, day: 20 }) + 'T12:00:00Z').toISOString(),
    });

    const firstPreview = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: firstPeriod.id, raw: true });
    expect(firstPreview.linkedPayments.map((c) => c.id)).toEqual([tx.id]);

    await helpers.markSubscriptionPeriodPaid({ id: sub.id, periodId: firstPeriod.id, transactionId: tx.id, raw: true });
    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    const secondPeriod = detail.periods.find((p) => p.status !== SUBSCRIPTION_PERIOD_STATUSES.paid)!;

    const secondPreview = await helpers.getSubscriptionPayPreview({
      id: sub.id,
      periodId: secondPeriod.id,
      raw: true,
    });
    expect(secondPreview.linkedPayments).toEqual([]);
  });

  it('orders several candidates nearest to the due date first', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { sub, openPeriod } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: -1, day: 15 }),
    });
    const idByDay: Record<number, string> = {};
    for (const day of [2, 16, 28]) {
      const tx = await createLinkedTx({
        accountId: account.id,
        subscriptionId: sub.id,
        time: new Date(futureDate({ monthsAhead: -1, day }) + 'T12:00:00Z').toISOString(),
      });
      idByDay[day] = tx.id;
    }

    const preview = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: openPeriod.id, raw: true });
    expect(preview.linkedPayments.map((c) => c.id)).toEqual([idByDay[16], idByDay[2], idByDay[28]]);
  });

  it('excludes a linked payment dated on the next due day, with and without a next period row', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { sub, openPeriod } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: -2, day: 15 }),
    });
    const inWindow = await createLinkedTx({
      accountId: account.id,
      subscriptionId: sub.id,
      time: new Date(futureDate({ monthsAhead: -2, day: 20 }) + 'T12:00:00Z').toISOString(),
    });
    await createLinkedTx({
      accountId: account.id,
      subscriptionId: sub.id,
      time: new Date(futureDate({ monthsAhead: -1, day: 15 }) + 'T12:00:00Z').toISOString(),
    });

    const scheduled = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: openPeriod.id, raw: true });
    expect(scheduled.linkedPayments.map((c) => c.id)).toEqual([inWindow.id]);

    await helpers.markSubscriptionPeriodPaid({ id: sub.id, periodId: openPeriod.id, raw: true });
    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(detail.periods.map((p) => p.dueDate)).toContain(futureDate({ monthsAhead: -1, day: 15 }));

    const withNextRow = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: openPeriod.id, raw: true });
    expect(withNextRow.linkedPayments.map((c) => c.id)).toEqual([inWindow.id]);
  });

  it('first period: excludes a linked payment older than one cycle before the due date', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { sub, openPeriod } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: -1, day: 15 }),
    });
    await createLinkedTx({
      accountId: account.id,
      subscriptionId: sub.id,
      time: new Date(futureDate({ monthsAhead: -3, day: 15 }) + 'T12:00:00Z').toISOString(),
    });
    const withinCycle = await createLinkedTx({
      accountId: account.id,
      subscriptionId: sub.id,
      time: new Date(futureDate({ monthsAhead: -1, day: 2 }) + 'T12:00:00Z').toISOString(),
    });

    const preview = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: openPeriod.id, raw: true });
    expect(preview.linkedPayments.map((c) => c.id)).toEqual([withinCycle.id]);
  });

  it('does not return a payment that was unlinked', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { sub, openPeriod } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: 0, day: 15 }),
    });
    const tx = await createLinkedTx({ accountId: account.id, subscriptionId: sub.id });
    await helpers.unlinkTransactionsFromSubscription({ id: sub.id, transactionIds: [tx.id], raw: true });

    const preview = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: openPeriod.id, raw: true });
    expect(preview.linkedPayments).toEqual([]);
  });

  it('does not return a linked planned transaction', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { sub, openPeriod } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: 0, day: 15 }),
    });
    const [planned] = await helpers.createPlannedTransaction({
      payload: { accountId: account.id, amount: 12.5, time: addDays(new Date(), 1).toISOString() },
      raw: true,
    });
    await helpers.linkTransactionsToSubscription({ id: sub.id, transactionIds: [planned.id], raw: true });

    const preview = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: openPeriod.id, raw: true });
    expect(preview.linkedPayments).toEqual([]);
  });

  it('paying with the candidate links it: one transaction, not auto-created, paidAt is its date', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { sub, openPeriod } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: -1, day: 20 }),
    });
    const txDate = futureDate({ monthsAhead: -1, day: 14 });
    const tx = await createLinkedTx({
      accountId: account.id,
      subscriptionId: sub.id,
      time: new Date(txDate + 'T12:00:00Z').toISOString(),
    });

    const preview = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: openPeriod.id, raw: true });
    expect(preview.linkedPayments.map((c) => c.id)).toEqual([tx.id]);

    const period = await helpers.markSubscriptionPeriodPaid({
      id: sub.id,
      periodId: openPeriod.id,
      transactionId: preview.linkedPayments[0]!.id,
      raw: true,
    });
    expect(period.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(period.transactionId).toBe(tx.id);
    expect(period.transactionAutoCreated).toBe(false);
    expect(format(new Date(period.paidAt!), 'yyyy-MM-dd')).toBe(txDate);

    const txs = await helpers.getTransactions({ accountIds: [account.id], raw: true });
    expect(txs).toHaveLength(1);
    expect(txs[0]!.id).toBe(tx.id);
  });

  it('paying with the candidate and an explicit time stamps paidAt with that time', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { sub, openPeriod } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: -1, day: 20 }),
    });
    const tx = await createLinkedTx({
      accountId: account.id,
      subscriptionId: sub.id,
      time: new Date(futureDate({ monthsAhead: -1, day: 14 }) + 'T12:00:00Z').toISOString(),
    });
    const paidTime = new Date(futureDate({ monthsAhead: -1, day: 18 }) + 'T12:00:00Z').toISOString();

    const period = await helpers.markSubscriptionPeriodPaid({
      id: sub.id,
      periodId: openPeriod.id,
      transactionId: tx.id,
      time: paidTime,
      raw: true,
    });
    expect(period.transactionId).toBe(tx.id);
    expect(new Date(period.paidAt!).toISOString()).toBe(paidTime);
  });

  it('returns 404 for a period that belongs to another subscription', async () => {
    const account = await helpers.createAccount({ raw: true });
    const { sub } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: 1, day: 1 }),
    });
    const { openPeriod: foreignPeriod } = await createSubWithOpenPeriod({
      accountId: account.id,
      dueDate: futureDate({ monthsAhead: 1, day: 1 }),
    });

    const res = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: foreignPeriod.id });
    expect(res.statusCode).toBe(404);

    const missing = await helpers.getSubscriptionPayPreview({ id: sub.id, periodId: generateRandomRecordId() });
    expect(missing.statusCode).toBe(404);
  });
});

describe('Cross-currency pay when the billed currency is unconnected', () => {
  // UAH ships rates in MODELS_CURRENCIES but is NOT connected to a fresh user, so a
  // subscription billed in it reproduces the unconnected-currency path.
  it('auto-connects the billed currency on create-mode pay and books the converted amount (no 404)', async () => {
    const uahCode = global.MODELS_CURRENCIES!.find((c) => c.code === 'UAH')!.code;
    const account = await helpers.createAccount({ raw: true }); // base currency
    const sub = await helpers.createSubscription({
      name: 'Unconnected-currency plan',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: futureDate({ monthsAhead: 1, day: 1 }),
      dueDate: futureDate({ monthsAhead: 1, day: 1 }),
      accountId: account.id,
      categoryId: global.DEFAULT_CATEGORY_ID,
      expectedAmount: 100,
      expectedCurrencyCode: uahCode, // user has NOT connected UAH
      raw: true,
    });

    const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    const upcoming = detail.periods.find((p) => p.status === SUBSCRIPTION_PERIOD_STATUSES.upcoming);

    // Quick-pay with no amount override: the billed currency is auto-connected so the
    // rate lookup no longer throws a 404, and the expense books in the account currency.
    const paid = await helpers.markSubscriptionPeriodPaid({
      id: sub.id,
      periodId: upcoming!.id,
      createTransaction: true,
      raw: true,
    });

    expect(paid.status).toBe(SUBSCRIPTION_PERIOD_STATUSES.paid);
    expect(paid.transactionId).toBeTruthy();

    const tx = await helpers.getTransactionById({ id: paid.transactionId!, raw: true });
    expect(tx).not.toBeNull();
    expect(tx!.currencyCode).toBe(global.BASE_CURRENCY.code);
    expect(tx!.amount).toBeGreaterThan(0);
  });

  it('previews with convertedAmount null instead of erroring when the currency is unconnected', async () => {
    const uahCode = global.MODELS_CURRENCIES!.find((c) => c.code === 'UAH')!.code;
    const account = await helpers.createAccount({ raw: true });
    const sub = await helpers.createSubscription({
      name: 'Unconnected-currency preview',
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: futureDate({ monthsAhead: 1, day: 1 }),
      dueDate: futureDate({ monthsAhead: 1, day: 1 }),
      accountId: account.id,
      categoryId: global.DEFAULT_CATEGORY_ID,
      expectedAmount: 100,
      expectedCurrencyCode: uahCode,
      raw: true,
    });

    // Create connects the billed currency so conversions work. Disconnect it here
    // to reproduce a subscription whose currency the user later removed — the
    // preview must still open (degraded amount) rather than 4xx/5xx.
    await helpers.deleteUserCurrency({ currencyCode: uahCode, raw: true });

    const preview = await helpers.getSubscriptionPayPreview({ id: sub.id, raw: true });
    expect(preview.isCrossCurrency).toBe(true);
    expect(preview.subscriptionCurrencyCode).toBe(uahCode);
    expect(preview.expectedAmount).toBe(100);
    // Best-effort: an unresolved rate degrades to null rather than a 4xx/5xx.
    expect(preview.convertedAmount).toBeNull();
  });
});

describe('Issue #422: Additional Recurring Income E2E validation', () => {
  it('prevents updating transactionType on an existing subscription', async () => {
    const account = await helpers.createAccount({ raw: true });
    const sub = await helpers.createSubscription({
      name: 'Salary',
      transactionType: TRANSACTION_TYPES.income,
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: futureDate({ monthsAhead: 1, day: 1 }),
      dueDate: futureDate({ monthsAhead: 1, day: 1 }),
      accountId: account.id,
      categoryId: global.DEFAULT_CATEGORY_ID,
      expectedAmount: 3000,
      expectedCurrencyCode: global.BASE_CURRENCY.code,
      raw: true,
    });

    expect(sub.transactionType).toBe(TRANSACTION_TYPES.income);

    // Attempt to update transactionType to expense (will be ignored or rejected by validation)
    await helpers.updateSubscription({
      id: sub.id,
      name: 'Salary Updated',
      transactionType: TRANSACTION_TYPES.expense,
    } as any);

    const updated = await helpers.getSubscriptionById({ id: sub.id, raw: true });
    expect(updated.name).toBe('Salary Updated');
    expect(updated.transactionType).toBe(TRANSACTION_TYPES.income); // Still income!
  });

  it('enforces matching rules match by correct transaction type direction', async () => {
    const account = await helpers.createAccount({ raw: true });

    // Create an income subscription with matching rule "note contains Salary"
    const subIncome = await helpers.createSubscription({
      name: 'Salary Match',
      transactionType: TRANSACTION_TYPES.income,
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: futureDate({ monthsAhead: 1, day: 1 }),
      dueDate: futureDate({ monthsAhead: 1, day: 1 }),
      accountId: account.id,
      categoryId: global.DEFAULT_CATEGORY_ID,
      expectedAmount: 2000,
      expectedCurrencyCode: global.BASE_CURRENCY.code,
      matchingRules: {
        rules: [{ field: 'note', operator: 'contains_any', value: ['Salary'] }],
      },
      raw: true,
    });

    // Create an expense transaction with note containing "Salary"
    const txExpense = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: account.id }),
        accountId: account.id,
        amount: 2000,
        transactionType: TRANSACTION_TYPES.expense,
        note: 'Salary payment (mistake)',
      },
      raw: true,
    });

    const suggestions = await helpers.getSuggestedMatches({
      id: subIncome.id,
      raw: true,
    });

    // Should NOT suggest the expense transaction because the subscription is income!
    const hasExpenseMatch = suggestions.some((s) => s.id === txExpense[0].id);
    expect(hasExpenseMatch).toBe(false);
  });
});

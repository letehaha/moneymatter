import { type RecordId, SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_TYPES, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const createKwdExpense = async ({ accountId, amount, note }: { accountId: RecordId; amount: number; note: string }) => {
  const [transaction] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId, amount, note, transactionType: TRANSACTION_TYPES.expense }),
    raw: true,
  });
  return transaction!;
};

const createKwdSubscription = async ({ accountId, currencyCode }: { accountId: RecordId; currencyCode?: string }) =>
  helpers.createSubscription({
    name: 'KWD service',
    expectedAmount: 1.237,
    expectedCurrencyCode: 'KWD',
    frequency: SUBSCRIPTION_FREQUENCIES.monthly,
    startDate: '2025-01-01',
    accountId,
    matchingRules: {
      rules: [
        { field: 'note', operator: 'contains_any', value: ['kwdsvc'] },
        {
          field: 'amount',
          operator: 'between',
          value: { min: 1.236, max: 1.238 },
          ...(currencyCode && { currencyCode }),
        },
      ],
    },
    raw: true,
  });

describe('Subscription amounts at the currency decimals', () => {
  describe('amount rules on a 3-decimal currency', () => {
    it.each([undefined, 'KWD'])(
      'suggests a payment inside the bounds and leaves one just outside them, with rule currency %s',
      async (currencyCode) => {
        const { account } = await helpers.createAccountWithNewCurrency({ currency: 'KWD' });
        const inside = await createKwdExpense({ accountId: account.id, amount: 1.237, note: 'KWDSVC monthly' });
        const outside = await createKwdExpense({ accountId: account.id, amount: 1.239, note: 'KWDSVC monthly' });

        const subscription = await createKwdSubscription({ accountId: account.id, currencyCode });
        const suggestedIds = (await helpers.getSuggestedMatches({ id: subscription.id, raw: true })).map(
          (tx: { id: string }) => tx.id,
        );

        expect(suggestedIds).toContain(inside.id);
        expect(suggestedIds).not.toContain(outside.id);
      },
    );

    it('links a new payment inside the bounds and not one just outside them', async () => {
      const { account } = await helpers.createAccountWithNewCurrency({ currency: 'KWD' });
      const subscription = await createKwdSubscription({ accountId: account.id, currencyCode: 'KWD' });

      await createKwdExpense({ accountId: account.id, amount: 1.239, note: 'KWDSVC monthly' });
      expect((await helpers.getSubscriptionById({ id: subscription.id, raw: true })).transactions).toHaveLength(0);

      const inside = await createKwdExpense({ accountId: account.id, amount: 1.237, note: 'KWDSVC monthly' });
      const linked = (await helpers.getSubscriptionById({ id: subscription.id, raw: true })).transactions;
      expect(linked.map((tx: { id: string }) => tx.id)).toEqual([inside.id]);
    });
  });

  describe('GET /subscriptions/summary', () => {
    it('rounds the totals to a base currency without minor units', async () => {
      await helpers.asNewUserWithBaseCurrency({
        currencyCode: 'JPY',
        fn: async () => {
          await helpers.createSubscription({
            name: 'Yearly plan',
            expectedAmount: 10000,
            expectedCurrencyCode: 'JPY',
            frequency: SUBSCRIPTION_FREQUENCIES.annual,
            startDate: '2025-01-01',
            raw: true,
          });

          const summary = await helpers.getSubscriptionsSummary({ raw: true });

          expect(summary.currencyCode).toBe('JPY');
          expect(summary.estimatedMonthlyCost).toBe(833);
          expect(summary.projectedYearlyCost).toBe(10000);
        },
      });
    });
  });

  describe('PUT /subscriptions/:id', () => {
    it('rejects an expected amount on a subscription that has no currency to hold it', async () => {
      const bill = await helpers.createSubscription({
        name: 'Variable bill',
        type: SUBSCRIPTION_TYPES.bill,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const response = await helpers.updateSubscription({ id: bill.id, expectedAmount: 10 });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await helpers.getSubscriptionById({ id: bill.id, raw: true })).expectedAmount).toBeNull();
    });

    it.each([
      { from: 'USD', amount: 15.5, to: 'JPY', expected: 16 },
      { from: 'KWD', amount: 1.235, to: 'USD', expected: 1.24 },
    ])(
      're-rounds a $from $amount amount to $to decimals on a currency-only change',
      async ({ from, amount, to, expected }) => {
        const subscription = await helpers.createSubscription({
          name: 'Currency switch',
          expectedAmount: amount,
          expectedCurrencyCode: from,
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });

        await helpers.updateSubscription({ id: subscription.id, expectedCurrencyCode: to, raw: true });

        const updated = await helpers.getSubscriptionById({ id: subscription.id, raw: true });
        expect(updated.expectedCurrencyCode).toBe(to);
        expect(updated.expectedAmount).toBe(expected);
      },
    );
  });
});

import { API_ERROR_CODES, SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_TYPES, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { ErrorResponse } from '@tests/helpers/common';
import { subMonths } from 'date-fns';

describe('Subscriptions', () => {
  describe('CRUD', () => {
    it('creates a subscription', async () => {
      const sub = await helpers.createSubscription({
        name: 'Netflix',
        expectedAmount: 15.99,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      expect(sub.name).toBe('Netflix');
      expect(sub.frequency).toBe(SUBSCRIPTION_FREQUENCIES.monthly);
      expect(sub.isActive).toBe(true);
    });

    it('stores the expected amount at the decimals of its currency', async () => {
      const common = { frequency: SUBSCRIPTION_FREQUENCIES.monthly, startDate: '2025-01-01', raw: true } as const;

      const usd = await helpers.createSubscription({
        ...common,
        name: 'USD plan',
        expectedAmount: 9.995,
        expectedCurrencyCode: 'USD',
      });
      const jpy = await helpers.createSubscription({
        ...common,
        name: 'JPY plan',
        expectedAmount: 1500.6,
        expectedCurrencyCode: 'JPY',
      });
      const kwd = await helpers.createSubscription({
        ...common,
        name: 'KWD plan',
        expectedAmount: 1.2345,
        expectedCurrencyCode: 'KWD',
      });

      expect(usd.expectedAmount).toBe(10);
      expect(jpy.expectedAmount).toBe(1501);
      expect(kwd.expectedAmount).toBe(1.235);

      const updated = await helpers.updateSubscription({ id: kwd.id, expectedAmount: 2.3456, raw: true });
      expect(updated.expectedAmount).toBe(2.346);
    });

    it('creates a subscription with all optional fields', async () => {
      const account = await helpers.createAccount({ raw: true });
      const categories = await helpers.getCategoriesList();
      const categoryId = categories[0]!.id;

      const sub = await helpers.createSubscription({
        name: 'Spotify',
        type: SUBSCRIPTION_TYPES.subscription,
        expectedAmount: 9.99,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-15',
        endDate: '2026-01-15',
        accountId: account.id,
        categoryId,
        matchingRules: {
          rules: [{ field: 'note', operator: 'contains_any', value: ['spotify'] }],
        },
        notes: 'Family plan',
        raw: true,
      });

      expect(sub.name).toBe('Spotify');
      expect(sub.expectedAmount).toBe(9.99);
      expect(sub.accountId).toBe(account.id);
      expect(sub.categoryId).toBe(categoryId);
      expect(sub.notes).toBe('Family plan');
    });

    it('lists subscriptions', async () => {
      await helpers.createSubscription({
        name: 'Sub A',
        expectedAmount: 10,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });
      await helpers.createSubscription({
        name: 'Sub B',
        expectedAmount: 5,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.weekly,
        startDate: '2025-02-01',
        raw: true,
      });

      const list = await helpers.getSubscriptions({ raw: true });
      expect(list.length).toBeGreaterThanOrEqual(2);
    });

    it('gets subscription by id', async () => {
      const sub = await helpers.createSubscription({
        name: 'Detail Sub',
        expectedAmount: 15.99,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.name).toBe('Detail Sub');
      expect(detail.transactions).toBeDefined();
      expect(detail.nextExpectedDate).toBeDefined();
    });

    it('updates a subscription', async () => {
      const sub = await helpers.createSubscription({
        name: 'Original',
        expectedAmount: 9.99,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const updated = await helpers.updateSubscription({
        id: sub.id,
        name: 'Updated',
        frequency: SUBSCRIPTION_FREQUENCIES.quarterly,
        raw: true,
      });

      expect(updated.name).toBe('Updated');
      expect(updated.frequency).toBe(SUBSCRIPTION_FREQUENCIES.quarterly);
    });

    it('rejects invalid create/update date payloads', async () => {
      const invertedCreate = await helpers.createSubscription({
        name: 'Inverted Range',
        expectedAmount: 9.99,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-02-01',
        endDate: '2025-01-01',
        raw: false,
      });
      expect(invertedCreate.statusCode).toBe(ERROR_CODES.ValidationError);

      const badDueDateCreate = await helpers.createSubscription({
        name: 'Bad Due Date',
        expectedAmount: 9.99,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        dueDate: '2020-13-45',
        raw: false,
      });
      expect(badDueDateCreate.statusCode).toBe(ERROR_CODES.ValidationError);

      const sub = await helpers.createSubscription({
        name: 'Date Guards',
        expectedAmount: 9.99,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const badDueDateUpdate = await helpers.updateSubscription({
        id: sub.id,
        dueDate: '2020-13-45',
        raw: false,
      });
      expect(badDueDateUpdate.statusCode).toBe(ERROR_CODES.ValidationError);

      const invertedUpdate = await helpers.updateSubscription({
        id: sub.id,
        startDate: '2025-02-01',
        endDate: '2025-01-01',
        raw: false,
      });
      expect(invertedUpdate.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('deletes a subscription', async () => {
      const sub = await helpers.createSubscription({
        name: 'To Delete',
        expectedAmount: 9.99,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const res = await helpers.deleteSubscription({ id: sub.id });
      expect(res.statusCode).toBe(200);

      const getRes = await helpers.getSubscriptionById({ id: sub.id });
      expect(getRes.statusCode).toBe(404);
    });
  });

  describe('Transaction Linking', () => {
    it('walks the full link / double-link guard / unlink / re-link / re-target lifecycle', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Create the transaction before the subscriptions: auto-matching runs only on
      // transaction create, so it stays unlinked until the explicit link call below.
      const recentTime = subMonths(new Date(), 6).toISOString();
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 15,
          note: 'netflix payment',
          transactionType: TRANSACTION_TYPES.expense,
          time: recentTime,
        }),
        raw: true,
      });

      const subA = await helpers.createSubscription({
        name: 'Netflix',
        expectedAmount: 15,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        matchingRules: {
          rules: [{ field: 'note', operator: 'contains_any', value: ['netflix'] }],
        },
        raw: true,
      });

      const subB = await helpers.createSubscription({
        name: 'Second Sub',
        expectedAmount: 15,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const linkRes = await helpers.linkTransactionsToSubscription({
        id: subA.id,
        transactionIds: [tx.id],
        raw: true,
      });
      expect(linkRes.linked).toBe(1);

      let detailA = await helpers.getSubscriptionById({ id: subA.id, raw: true });
      expect(detailA.transactions.length).toBe(1);
      expect(detailA.transactions[0]!.id).toBe(tx.id);

      const doubleLinkRes = await helpers.linkTransactionsToSubscription({
        id: subB.id,
        transactionIds: [tx.id],
      });
      expect(doubleLinkRes.statusCode).toBe(409);

      const whileLinked = await helpers.getSuggestedMatches({ id: subA.id, raw: true });
      expect(whileLinked.map((s: { id: string }) => s.id)).not.toContain(tx.id);

      const unlinkRes = await helpers.unlinkTransactionsFromSubscription({
        id: subA.id,
        transactionIds: [tx.id],
        raw: true,
      });
      expect(unlinkRes.unlinked).toBe(1);

      detailA = await helpers.getSubscriptionById({ id: subA.id, raw: true });
      expect(detailA.transactions.length).toBe(0);

      const whileUnlinked = await helpers.getSuggestedMatches({ id: subA.id, raw: true });
      expect(whileUnlinked.map((s: { id: string }) => s.id)).toContain(tx.id);

      const reLinkRes = await helpers.linkTransactionsToSubscription({
        id: subA.id,
        transactionIds: [tx.id],
        raw: true,
      });
      expect(reLinkRes.linked).toBe(1);

      detailA = await helpers.getSubscriptionById({ id: subA.id, raw: true });
      expect(detailA.transactions.length).toBe(1);

      await helpers.unlinkTransactionsFromSubscription({
        id: subA.id,
        transactionIds: [tx.id],
        raw: true,
      });

      const linkToBRes = await helpers.linkTransactionsToSubscription({
        id: subB.id,
        transactionIds: [tx.id],
        raw: true,
      });
      expect(linkToBRes.linked).toBe(1);

      const detailB = await helpers.getSubscriptionById({ id: subB.id, raw: true });
      expect(detailB.transactions.length).toBe(1);
      expect(detailB.transactions[0]!.id).toBe(tx.id);

      detailA = await helpers.getSubscriptionById({ id: subA.id, raw: true });
      expect(detailA.transactions.length).toBe(0);
    }, 60_000);

    it('prevents linking a transaction whose type differs from the subscription', async () => {
      const account = await helpers.createAccount({ raw: true });
      const sub = await helpers.createSubscription({
        name: 'Expense Sub',
        transactionType: TRANSACTION_TYPES.expense,
        expectedAmount: 15,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1500,
          transactionType: TRANSACTION_TYPES.income,
          time: '2025-01-15T10:00:00Z',
        }),
        raw: true,
      });

      const res = await helpers.linkTransactionsToSubscription({
        id: sub.id,
        transactionIds: [tx.id],
      });

      expect(res.statusCode).toBe(422);

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.transactions.length).toBe(0);
    });
  });

  describe('Subscription list counts', () => {
    it('linkedTransactionsCount excludes unlinked transactions', async () => {
      const account = await helpers.createAccount({ raw: true });
      const sub = await helpers.createSubscription({
        name: 'Count Test',
        expectedAmount: 10,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const [tx1] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 1000 }),
        raw: true,
      });
      const [tx2] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 2000 }),
        raw: true,
      });

      await helpers.linkTransactionsToSubscription({
        id: sub.id,
        transactionIds: [tx1.id, tx2.id],
        raw: true,
      });

      // Unlink one
      await helpers.unlinkTransactionsFromSubscription({
        id: sub.id,
        transactionIds: [tx1.id],
        raw: true,
      });

      const list = await helpers.getSubscriptions({ raw: true });
      const found = list.find((s: { id: string }) => s.id === sub.id);
      expect(found?.linkedTransactionsCount).toBe(1);
    });
  });

  describe('Suggest historical matches', () => {
    it('suggests transactions matching rules', async () => {
      const account = await helpers.createAccount({ raw: true });

      // Use a relative date so the test stays within the suggester's 12-month
      // history window regardless of when CI runs
      const recentTime = subMonths(new Date(), 6).toISOString();

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1500,
          note: 'NETFLIX subscription',
          transactionType: TRANSACTION_TYPES.expense,
          time: recentTime,
        }),
        raw: true,
      });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 2000,
          note: 'Grocery store',
          transactionType: TRANSACTION_TYPES.expense,
          time: recentTime,
        }),
        raw: true,
      });

      const sub = await helpers.createSubscription({
        name: 'Netflix',
        expectedAmount: 15,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        matchingRules: {
          rules: [{ field: 'note', operator: 'contains_any', value: ['netflix'] }],
        },
        raw: true,
      });

      const suggestions = await helpers.getSuggestedMatches({ id: sub.id, raw: true });
      expect(suggestions.length).toBeGreaterThanOrEqual(1);
      expect(suggestions.every((s: { note: string | null }) => s.note?.toLowerCase().includes('netflix'))).toBe(true);
    });

    it('suggests cross-currency transactions matching amount rules after conversion', async () => {
      // Test exchange rate in seeded data: 1 USD ≈ 41.43 UAH
      const UAH_PER_USD = 41.429899;

      // Create an account in UAH (different from the subscription's rule currency)
      const { account } = await helpers.createAccountWithNewCurrency({ currency: 'UAH' });

      // Transaction: $9.99 equivalent in UAH = ~413.89 UAH
      const uahAmount = Math.round(999 * UAH_PER_USD) / 100; // Convert USD cents to UAH decimal
      // Use a relative date so the test stays within the suggester's 12-month
      // history window regardless of when CI runs
      const recentTime = subMonths(new Date(), 6).toISOString();
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: uahAmount,
          note: 'APPLE.COM/BILL',
          transactionType: TRANSACTION_TYPES.expense,
          time: recentTime,
        }),
        raw: true,
      });

      // Create subscription with amount rule in USD ($9-$11)
      // The transaction is in UAH but should match after conversion
      const sub = await helpers.createSubscription({
        name: 'Apple TV',
        expectedAmount: 9.99,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        matchingRules: {
          rules: [
            { field: 'note', operator: 'contains_any', value: ['apple'] },
            { field: 'amount', operator: 'between', value: { min: 9, max: 11 }, currencyCode: 'USD' },
          ],
        },
        raw: true,
      });

      // The historical match suggestions should include the UAH transaction
      // after converting its amount to USD and seeing it falls within $9-$11
      const suggestions = await helpers.getSuggestedMatches({ id: sub.id, raw: true });
      const suggestedIds = suggestions.map((s: { id: string }) => s.id);

      expect(suggestedIds).toContain(tx.id);
    });
  });

  describe('Summary', () => {
    describe('GET /subscriptions/summary', () => {
      it('returns costs, the expense/income split and a null percentOfIncome off one call', async () => {
        await helpers.createSubscription({
          name: 'Netflix',
          transactionType: TRANSACTION_TYPES.expense,
          expectedAmount: 15,
          expectedCurrencyCode: global.BASE_CURRENCY_CODE,
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });

        await helpers.createSubscription({
          name: 'Paycheck',
          transactionType: TRANSACTION_TYPES.income,
          expectedAmount: 2500,
          expectedCurrencyCode: global.BASE_CURRENCY_CODE,
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });

        const summary = await helpers.getSubscriptionsSummary({ raw: true });

        expect(summary.activeCount).toEqual({ expense: 1, income: 1 });
        expect(summary.estimatedMonthlyCost).toBe(15);
        expect(summary.projectedYearlyCost).toBe(180);
        expect(summary.expectedMonthlyIncome).toBe(2500);
        expect(summary.currencyCode).toBe(global.BASE_CURRENCY_CODE);
        // averageMonthlyIncome counts income transactions, so income subscriptions leave it at 0.
        expect(summary.averageMonthlyIncome).toBe(0);
        expect(summary.percentOfIncome).toBeNull();
      });

      it('returns zeros when no active subscriptions exist', async () => {
        const summary = await helpers.getSubscriptionsSummary({ raw: true });

        expect(summary.activeCount).toEqual({ expense: 0, income: 0 });
        expect(summary.estimatedMonthlyCost).toBe(0);
        expect(summary.projectedYearlyCost).toBe(0);
      });

      it('rejects invalid summary query params', async () => {
        const badType = await helpers.getSubscriptionsSummary({ type: 'invalid_type' });
        expect(badType.statusCode).toBe(422);

        const badLookback = await helpers.getSubscriptionsSummary({ lookbackMonths: 5 });
        expect(badLookback.statusCode).toBe(422);
      });

      it('filters by subscription type', async () => {
        await helpers.createSubscription({
          name: 'Netflix',
          type: SUBSCRIPTION_TYPES.subscription,
          expectedAmount: 15,
          expectedCurrencyCode: global.BASE_CURRENCY_CODE,
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });
        await helpers.createSubscription({
          name: 'Electricity',
          type: SUBSCRIPTION_TYPES.bill,
          expectedAmount: 100,
          expectedCurrencyCode: global.BASE_CURRENCY_CODE,
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });

        const all = await helpers.getSubscriptionsSummary({ raw: true });
        expect(all.activeCount).toEqual({ expense: 2, income: 0 });
        expect(all.estimatedMonthlyCost).toBe(115);

        const subsOnly = await helpers.getSubscriptionsSummary({
          type: SUBSCRIPTION_TYPES.subscription,
          raw: true,
        });
        expect(subsOnly.activeCount).toEqual({ expense: 1, income: 0 });
        expect(subsOnly.estimatedMonthlyCost).toBe(15);

        const billsOnly = await helpers.getSubscriptionsSummary({
          type: SUBSCRIPTION_TYPES.bill,
          raw: true,
        });
        expect(billsOnly.activeCount).toEqual({ expense: 1, income: 0 });
        expect(billsOnly.estimatedMonthlyCost).toBe(100);
      });

      it('excludes inactive subscriptions and subscriptions without expectedAmount', async () => {
        const paused = await helpers.createSubscription({
          name: 'Paused Sub',
          expectedAmount: 20,
          expectedCurrencyCode: global.BASE_CURRENCY_CODE,
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });
        await helpers.toggleSubscriptionActive({ id: paused.id, isActive: false, raw: true });

        await helpers.createSubscription({
          name: 'No Amount Sub',
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });

        const summary = await helpers.getSubscriptionsSummary({ raw: true });
        expect(summary.activeCount).toEqual({ expense: 0, income: 0 });
        expect(summary.estimatedMonthlyCost).toBe(0);
      });

      it('normalizes annual frequency to monthly', async () => {
        await helpers.createSubscription({
          name: 'Annual Sub',
          expectedAmount: 120,
          expectedCurrencyCode: global.BASE_CURRENCY_CODE,
          frequency: SUBSCRIPTION_FREQUENCIES.annual,
          startDate: '2025-01-01',
          raw: true,
        });

        const summary = await helpers.getSubscriptionsSummary({ raw: true });
        expect(summary.activeCount).toEqual({ expense: 1, income: 0 });
        // $120/year → $10/month
        expect(summary.estimatedMonthlyCost).toBe(10);
        expect(summary.projectedYearlyCost).toBe(120);
      });

      it('auto-connects the subscription currency on create and on update', async () => {
        const sub = await helpers.createSubscription({
          name: 'Foreign Sub',
          expectedAmount: 100,
          expectedCurrencyCode: 'UAH',
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });

        const afterCreate = await helpers.getUserCurrencies();
        expect(afterCreate.map((c) => c.currencyCode)).toContain('UAH');

        const summary = await helpers.getSubscriptionsSummary({ raw: true });
        expect(summary.activeCount).toEqual({ expense: 1, income: 0 });
        expect(summary.estimatedMonthlyCost).toBeGreaterThan(0);

        await helpers.updateSubscription({
          id: sub.id,
          expectedAmount: 15,
          expectedCurrencyCode: 'EUR',
          raw: true,
        });

        const afterUpdate = await helpers.getUserCurrencies();
        expect(afterUpdate.map((c) => c.currencyCode)).toContain('EUR');
      });

      it('returns CURRENCY_NOT_CONNECTED with the offending codes when a subscription currency is disconnected', async () => {
        await helpers.createSubscription({
          name: 'Foreign Sub',
          expectedAmount: 100,
          expectedCurrencyCode: 'UAH',
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });

        // Sever the auto-created connection to reproduce pre-guard data.
        await helpers.makeRequest({
          method: 'delete',
          url: '/user/currency',
          payload: { currencyCode: 'UAH' },
          raw: true,
        });

        const res = await helpers.getSubscriptionsSummary();
        expect(res.statusCode).toBe(422);
        // The typed helper promises the success shape; the error envelope needs
        // a detour through unknown.
        const err = res.body.response as unknown as ErrorResponse;
        expect(err.code).toBe(API_ERROR_CODES.currencyNotConnected);
        expect(err.details).toEqual({ currencyCodes: ['UAH'] });
      });

      it('converts every subscription in a manual-rate currency at the custom rate', async () => {
        await helpers.createSubscription({
          name: 'EUR Sub A',
          expectedAmount: 10,
          expectedCurrencyCode: 'EUR',
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });
        await helpers.createSubscription({
          name: 'EUR Sub B',
          expectedAmount: 20,
          expectedCurrencyCode: 'EUR',
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });

        await helpers.updateUserCurrency({
          currency: { currencyCode: 'EUR', liveRateUpdate: false },
          raw: true,
        });
        const rateRes = await helpers.editCurrencyExchangeRate({
          pairs: [
            { baseCode: 'EUR', quoteCode: global.BASE_CURRENCY_CODE, rate: 5 },
            { baseCode: global.BASE_CURRENCY_CODE, quoteCode: 'EUR', rate: 0.2 },
          ],
        });
        expect(rateRes.statusCode).toBe(200);

        const summary = await helpers.getSubscriptionsSummary({ raw: true });
        expect(summary.activeCount).toEqual({ expense: 2, income: 0 });
        expect(summary.estimatedMonthlyCost).toBe(150);
        expect(summary.projectedYearlyCost).toBe(1800);
      });

      it('self-heals the base currency from a subscription currency and returns a summary', async () => {
        // A freshly signed-up user has no base currency row. Creating a
        // subscription connects its currency as a NON-default row, reproducing
        // the legacy no-base-currency state the summary must self-heal from.
        const secondUser = await helpers.signUpSecondUser();

        const { summary, baseCurrency } = await helpers.asUser({
          cookies: secondUser.cookies,
          fn: async () => {
            await helpers.createSubscription({
              name: 'Foreign Sub',
              expectedAmount: 15,
              expectedCurrencyCode: 'EUR',
              frequency: SUBSCRIPTION_FREQUENCIES.monthly,
              startDate: '2025-01-01',
              raw: true,
            });

            const summaryRes = await helpers.getSubscriptionsSummary({ raw: true });
            const currencies = await helpers.getUserCurrencies();
            return {
              summary: summaryRes,
              baseCurrency: currencies.find((c) => c.isDefaultCurrency),
            };
          },
        });

        // The subscription currency became the user's base currency under the hood.
        expect(baseCurrency?.currencyCode).toBe('EUR');

        // With base === subscription currency, no conversion is needed and the
        // monthly cost equals the expected amount.
        expect(summary.activeCount).toEqual({ expense: 1, income: 0 });
        expect(summary.estimatedMonthlyCost).toBe(15);
        expect(summary.currencyCode).toBe('EUR');
      });

      it('returns 422 when the user has no base currency and no currency signal to heal from', async () => {
        // A freshly signed-up user with no accounts, no connected currencies and
        // no subscriptions offers nothing to adopt as a base currency, so the
        // summary surfaces an actionable validation error instead of guessing.
        const secondUser = await helpers.signUpSecondUser();

        const res = await helpers.asUser({
          cookies: secondUser.cookies,
          fn: () => helpers.getSubscriptionsSummary(),
        });

        expect(res.statusCode).toBe(422);
        const err = res.body.response as unknown as ErrorResponse;
        expect(err.code).toBe(API_ERROR_CODES.validationError);
      });

      it('honors lookbackMonths query param when averaging income', async () => {
        const account = await helpers.createAccount({ raw: true });

        // Income only in the most recent complete month: $900
        const recent = subMonths(new Date(), 1);
        recent.setDate(10);
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 900,
            transactionType: TRANSACTION_TYPES.income,
            time: recent.toISOString(),
          }),
          raw: true,
        });

        // lookback=1 → avg = 900
        const oneMonth = await helpers.getSubscriptionsSummary({ lookbackMonths: 1, raw: true });
        expect(oneMonth.averageMonthlyIncome).toBe(900);
        expect(oneMonth.lookbackMonths).toBe(1);

        // lookback=12 → 900 / 12 = 75
        const twelveMonths = await helpers.getSubscriptionsSummary({ lookbackMonths: 12, raw: true });
        expect(twelveMonths.averageMonthlyIncome).toBe(75);
        expect(twelveMonths.lookbackMonths).toBe(12);
      });

      it('averages qualifying income and derives percentOfIncome, ignoring out-of-window income', async () => {
        const account = await helpers.createAccount({ raw: true });

        // Current month — should NOT count
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 9999,
            transactionType: TRANSACTION_TYPES.income,
            time: new Date().toISOString(),
          }),
          raw: true,
        });

        // 10 months ago — outside lookback window, should NOT count
        const old = subMonths(new Date(), 10);
        await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 9999,
            transactionType: TRANSACTION_TYPES.income,
            time: old.toISOString(),
          }),
          raw: true,
        });

        // $600 of income across the 6-month lookback averages to $100/month.
        for (const monthsAgo of [2, 3]) {
          // subMonths clamps month-end (Jul 31 to Jun 30); setMonth rolls over into the
          // current month and drops the transaction out of the 6-month lookback.
          const date = subMonths(new Date(), monthsAgo);
          date.setDate(10);
          await helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 300,
              transactionType: TRANSACTION_TYPES.income,
              time: date.toISOString(),
            }),
            raw: true,
          });
        }

        await helpers.createSubscription({
          name: 'Netflix',
          expectedAmount: 60,
          expectedCurrencyCode: global.BASE_CURRENCY_CODE,
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        });

        const summary = await helpers.getSubscriptionsSummary({ raw: true });
        expect(summary.estimatedMonthlyCost).toBe(60);
        expect(summary.averageMonthlyIncome).toBe(100);
        expect(summary.percentOfIncome).toBe(60);
      });
    });
  });

  describe('Auto-matching on transaction creation', () => {
    it('auto-matches by rule, stamps the category, skips non-matching notes and never re-matches an unlinked tx', async () => {
      const account = await helpers.createAccount({ raw: true });
      const category = await helpers.addCustomCategory({ raw: true, name: 'Entertainment', color: '#FF5733' });

      const sub = await helpers.createSubscription({
        name: 'Netflix',
        expectedAmount: 15.99,
        expectedCurrencyCode: 'USD',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        categoryId: category.id,
        matchingRules: {
          rules: [{ field: 'note', operator: 'contains_any', value: ['netflix'] }],
        },
        raw: true,
      });

      const [tx1] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1599,
          note: 'Netflix monthly payment',
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      let detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.transactions.length).toBe(1);
      expect(detail.transactions[0]!.note).toContain('Netflix');
      expect(detail.transactions[0]!.categoryId).toBe(category.id);

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1599,
          note: 'Spotify premium',
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.transactions.length).toBe(1);

      await helpers.unlinkTransactionsFromSubscription({
        id: sub.id,
        transactionIds: [tx1.id],
        raw: true,
      });

      detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.transactions.length).toBe(0);

      const [tx3] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1599,
          note: 'Netflix payment 2',
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });
      expect(detail.transactions.length).toBe(1);
      expect(detail.transactions[0]!.id).toBe(tx3.id);
    }, 60_000);
  });

  describe('Amount rule units (decimals)', () => {
    // Amounts are chosen so decimal and cents interpretations can't both pass:
    // 115.50 units (11550 cents) sits inside 100–130 as decimals and far outside it as cents.
    it('suggests a transaction whose amount falls inside a decimal amount rule', async () => {
      const account = await helpers.createAccount({ raw: true });
      const recentTime = subMonths(new Date(), 6).toISOString();

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 115.5,
          note: 'WFIRMA monthly fee',
          transactionType: TRANSACTION_TYPES.expense,
          time: recentTime,
        }),
        raw: true,
      });

      const sub = await helpers.createSubscription({
        name: 'wFirma',
        expectedAmount: 115.5,
        expectedCurrencyCode: global.BASE_CURRENCY_CODE,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        matchingRules: {
          rules: [
            { field: 'note', operator: 'contains_any', value: ['wfirma'] },
            { field: 'amount', operator: 'between', value: { min: 100, max: 130 } },
          ],
        },
        raw: true,
      });

      const suggestions = await helpers.getSuggestedMatches({ id: sub.id, raw: true });

      expect(suggestions.map((s: { id: string }) => s.id)).toContain(tx.id);
    });

    it('auto-matches a new transaction whose amount falls inside a decimal amount rule', async () => {
      const account = await helpers.createAccount({ raw: true });

      const sub = await helpers.createSubscription({
        name: 'wFirma',
        expectedAmount: 115.5,
        expectedCurrencyCode: global.BASE_CURRENCY_CODE,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        matchingRules: {
          rules: [
            { field: 'note', operator: 'contains_any', value: ['wfirma'] },
            { field: 'amount', operator: 'between', value: { min: 100, max: 130 } },
          ],
        },
        raw: true,
      });

      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 115.5,
          note: 'WFIRMA monthly fee',
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const detail = await helpers.getSubscriptionById({ id: sub.id, raw: true });

      expect(detail.transactions.map((t) => t.id)).toContain(tx.id);
    });

    it('accepts fractional amount-rule bounds on create and update', async () => {
      const createRes = await helpers.createSubscription({
        name: 'Fractional Bounds',
        expectedAmount: 15.99,
        expectedCurrencyCode: global.BASE_CURRENCY_CODE,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        matchingRules: {
          rules: [{ field: 'amount', operator: 'between', value: { min: 15.5, max: 16.5 } }],
        },
        raw: false,
      });

      expect(createRes.statusCode).toBe(201);

      const sub = await helpers.createSubscription({
        name: 'Fractional Bounds Update',
        expectedAmount: 15.99,
        expectedCurrencyCode: global.BASE_CURRENCY_CODE,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const updateRes = await helpers.updateSubscription({
        id: sub.id,
        matchingRules: {
          rules: [{ field: 'amount', operator: 'between', value: { min: 15.5, max: 16.5 } }],
        },
        raw: false,
      });

      expect(updateRes.statusCode).toBe(200);
    });
  });
});

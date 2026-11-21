import { API_ERROR_CODES, type CurrencyInUseDetails, type RecordId, SUBSCRIPTION_FREQUENCIES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import BudgetPlans from '@models/budget-plans.model';
import Transactions from '@models/transactions.model';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import * as helpers from '@tests/helpers';
import { ErrorResponse } from '@tests/helpers/common';

const CURRENCY = 'EUR';

const getConnectedCodes = async () => (await helpers.getUserCurrencies()).map((item) => item.currencyCode);

const expectBlocked = async ({ response }: { response: unknown }) => {
  const res = response as helpers.CustomResponse<unknown>;
  expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
  const err = res.body.response as unknown as ErrorResponse;
  expect(err.code).toBe(API_ERROR_CODES.currencyInUse);
  expect(await getConnectedCodes()).toContain(CURRENCY);
  return (err.details as CurrencyInUseDetails).blockers;
};

// The create helper's raw type is the model, but the endpoint answers with the serialized response.
type TxPayload = Parameters<typeof helpers.buildTransactionPayload>[0];
const createTx = async (payload: Pick<TxPayload, 'accountId'> & Partial<TxPayload>) => {
  const [tx] = (await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ amount: 30, ...payload }),
    raw: true,
  })) as unknown as (TransactionApiResponse & { id: RecordId })[];
  return tx!;
};

describe('DELETE /user/currency', () => {
  it('disconnects a currency nothing uses', async () => {
    await helpers.addUserCurrencyByCode({ code: CURRENCY, raw: true });

    const response = await helpers.deleteUserCurrency({ currencyCode: CURRENCY });

    expect(response.statusCode).toBe(200);
    expect(await getConnectedCodes()).not.toContain(CURRENCY);
  });

  it('rejects a currency that is not connected', async () => {
    const response = await helpers.deleteUserCurrency({ currencyCode: CURRENCY });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('rejects the default currency', async () => {
    const response = await helpers.deleteUserCurrency({ currencyCode: global.BASE_CURRENCY_CODE });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    expect(await getConnectedCodes()).toContain(global.BASE_CURRENCY_CODE);
  });

  describe('blocked by records in the currency', () => {
    it('lists an account', async () => {
      await helpers.addUserCurrencyByCode({ code: CURRENCY, raw: true });
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ name: 'Euro wallet', currencyCode: CURRENCY }),
        raw: true,
      });

      const blockers = await expectBlocked({ response: await helpers.deleteUserCurrency({ currencyCode: CURRENCY }) });

      expect(blockers).toEqual([{ type: 'account', id: account.id, name: 'Euro wallet' }]);
    });

    it('lists a goal', async () => {
      await helpers.addUserCurrencyByCode({ code: CURRENCY, raw: true });
      const goal = await helpers.createGoal({ payload: { name: 'Trip', currencyCode: CURRENCY }, raw: true });

      const blockers = await expectBlocked({ response: await helpers.deleteUserCurrency({ currencyCode: CURRENCY }) });

      expect(blockers).toEqual([{ type: 'goal', id: goal.id, name: 'Trip' }]);
    });

    it('lists a subscription', async () => {
      const subscription = await helpers.createSubscription({
        name: 'Streaming',
        expectedAmount: 10,
        expectedCurrencyCode: CURRENCY,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const blockers = await expectBlocked({ response: await helpers.deleteUserCurrency({ currencyCode: CURRENCY }) });

      expect(blockers).toEqual([{ type: 'subscription', id: subscription.id, name: 'Streaming' }]);
    });

    it('lists a budget, flagging it once trashed', async () => {
      await helpers.addUserCurrencyByCode({ code: CURRENCY, raw: true });
      const { plan } = await helpers.createBudgetPlan({ payload: { name: 'Household' }, raw: true });
      // A plan's currency is the base currency at creation and no endpoint changes it.
      await BudgetPlans.update({ currencyCode: CURRENCY }, { where: { id: plan.id } });

      const activeBlockers = await expectBlocked({
        response: await helpers.deleteUserCurrency({ currencyCode: CURRENCY }),
      });
      expect(activeBlockers).toEqual([{ type: 'budget', id: plan.id, name: 'Household', trashed: false }]);

      await helpers.deleteBudgetPlan({ planId: plan.id, raw: true });

      const trashedBlockers = await expectBlocked({
        response: await helpers.deleteUserCurrency({ currencyCode: CURRENCY }),
      });
      expect(trashedBlockers).toEqual([{ type: 'budget', id: plan.id, name: 'Household', trashed: true }]);
    });

    it('lists a portfolio display currency, including a trashed portfolio', async () => {
      await helpers.addUserCurrencyByCode({ code: CURRENCY, raw: true });
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'Display Portfolio' }),
        raw: true,
      });
      await helpers.updatePortfolio({ portfolioId: portfolio.id, payload: { displayCurrencyCode: CURRENCY } });

      const activeBlockers = await expectBlocked({
        response: await helpers.deleteUserCurrency({ currencyCode: CURRENCY }),
      });
      expect(activeBlockers).toEqual([
        { type: 'portfolio', id: portfolio.id, name: 'Display Portfolio', trashed: false },
      ]);

      await helpers.deletePortfolio({ portfolioId: portfolio.id });

      const trashedBlockers = await expectBlocked({
        response: await helpers.deleteUserCurrency({ currencyCode: CURRENCY }),
      });
      expect(trashedBlockers).toEqual([
        { type: 'portfolio', id: portfolio.id, name: 'Display Portfolio', trashed: true },
      ]);
    });

    it('lists a holding by portfolio and security symbol', async () => {
      const [security] = await helpers.seedSecurities([
        { symbol: 'ASML', name: 'ASML Holding', currencyCode: CURRENCY },
      ]);
      const portfolio = await helpers.createPortfolio({
        payload: helpers.buildPortfolioPayload({ name: 'EUR Portfolio' }),
        raw: true,
      });
      await helpers.createHolding({ payload: { portfolioId: portfolio.id, securityId: security!.id } });

      const blockers = await expectBlocked({ response: await helpers.deleteUserCurrency({ currencyCode: CURRENCY }) });

      expect(blockers).toContainEqual({
        type: 'holding',
        id: portfolio.id,
        name: 'EUR Portfolio: ASML',
        trashed: false,
      });
    }, 30000);

    it('lists every blocker together', async () => {
      await helpers.addUserCurrencyByCode({ code: CURRENCY, raw: true });
      const [account, goal, subscription] = await Promise.all([
        helpers.createAccount({
          payload: helpers.buildAccountPayload({ name: 'Euro wallet', currencyCode: CURRENCY }),
          raw: true,
        }),
        helpers.createGoal({ payload: { name: 'Trip', currencyCode: CURRENCY }, raw: true }),
        helpers.createSubscription({
          name: 'Streaming',
          expectedAmount: 10,
          expectedCurrencyCode: CURRENCY,
          frequency: SUBSCRIPTION_FREQUENCIES.monthly,
          startDate: '2025-01-01',
          raw: true,
        }),
      ]);

      const blockers = await expectBlocked({ response: await helpers.deleteUserCurrency({ currencyCode: CURRENCY }) });

      expect(blockers).toHaveLength(3);
      expect(blockers).toEqual(
        expect.arrayContaining([
          { type: 'account', id: account.id, name: 'Euro wallet' },
          { type: 'goal', id: goal.id, name: 'Trip' },
          { type: 'subscription', id: subscription.id, name: 'Streaming' },
        ]),
      );
    });
  });

  it('clears foreign amounts recorded in the currency and keeps the others', async () => {
    await helpers.addUserCurrencyByCode({ code: CURRENCY, raw: true });
    const account = await helpers.createAccount({ raw: true });

    const inCurrency = await createTx({ accountId: account.id, originalAmount: 27.5, originalCurrencyCode: CURRENCY });
    const inOtherCurrency = await createTx({
      accountId: account.id,
      originalAmount: 5000,
      originalCurrencyCode: 'JPY',
    });

    const response = await helpers.deleteUserCurrency({ currencyCode: CURRENCY });
    expect(response.statusCode).toBe(200);
    expect(await getConnectedCodes()).not.toContain(CURRENCY);

    const cleared = await helpers.getTransactionById({ id: inCurrency.id, raw: true });
    expect(cleared!.originalAmount).toBeNull();
    expect(cleared!.originalCurrencyCode).toBeNull();
    expect(cleared!.amount).toBe(30);
    expect(cleared!.currencyCode).toBe(global.BASE_CURRENCY_CODE);

    const untouched = await helpers.getTransactionById({ id: inOtherCurrency.id, raw: true });
    expect(untouched!.originalAmount).toBe(5000);
    expect(untouched!.originalCurrencyCode).toBe('JPY');
  });

  it('keeps foreign amounts when the delete is blocked', async () => {
    await helpers.addUserCurrencyByCode({ code: CURRENCY, raw: true });
    const account = await helpers.createAccount({ raw: true });
    const tx = await createTx({ accountId: account.id, originalAmount: 27.5, originalCurrencyCode: CURRENCY });
    await helpers.createGoal({ payload: { name: 'Trip', currencyCode: CURRENCY }, raw: true });

    await expectBlocked({ response: await helpers.deleteUserCurrency({ currencyCode: CURRENCY }) });

    const kept = await helpers.getTransactionById({ id: tx.id, raw: true });
    expect(kept!.originalAmount).toBe(27.5);
    expect(kept!.originalCurrencyCode).toBe(CURRENCY);
  });

  it("leaves another user's foreign amounts in the currency untouched", async () => {
    await helpers.addUserCurrencyByCode({ code: CURRENCY, raw: true });

    const secondUser = await helpers.provisionSecondUserWithBaseCurrency();
    const foreignTx = await helpers.asUser({
      cookies: secondUser.cookies,
      fn: async () => {
        await helpers.addUserCurrencyByCode({ code: CURRENCY, raw: true });
        const account = await helpers.createAccount({ raw: true });
        // The payload's default category belongs to the primary user.
        const [category] = await helpers.getCategoriesList();
        return createTx({
          accountId: account.id,
          categoryId: category!.id,
          originalAmount: 27.5,
          originalCurrencyCode: CURRENCY,
        });
      },
    });

    const response = await helpers.deleteUserCurrency({ currencyCode: CURRENCY });
    expect(response.statusCode).toBe(200);

    const kept = await helpers.asUser({
      cookies: secondUser.cookies,
      fn: () => helpers.getTransactionById({ id: foreignTx.id, raw: true }),
    });
    expect(kept!.originalAmount).toBe(27.5);
    expect(kept!.originalCurrencyCode).toBe(CURRENCY);
  });

  it('clears foreign amounts on trashed transactions', async () => {
    await helpers.addUserCurrencyByCode({ code: CURRENCY, raw: true });
    const account = await helpers.createAccount({ raw: true });
    const tx = await createTx({ accountId: account.id, originalAmount: 27.5, originalCurrencyCode: CURRENCY });
    await helpers.deleteTransaction({ id: tx.id });

    const response = await helpers.deleteUserCurrency({ currencyCode: CURRENCY });
    expect(response.statusCode).toBe(200);

    const trashed = await Transactions.findByPk(tx.id, { paranoid: false });
    expect(trashed!.deletedAt).not.toBeNull();
    expect(trashed!.originalAmount).toBeNull();
    expect(trashed!.originalCurrencyCode).toBeNull();
  });
});

import { type RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const createAccount = () =>
  helpers.createAccount({ payload: helpers.buildAccountPayload({ initialBalance: 1000 }), raw: true });

const createExpense = async ({ accountId, amount = 100 }: { accountId: RecordId; amount?: number }) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId, amount, transactionType: TRANSACTION_TYPES.expense }),
    raw: true,
  });
  return tx!;
};

const createPortfolioLinked = async ({ accountId }: { accountId: RecordId }) => {
  const portfolio = await helpers.createPortfolio({
    payload: helpers.buildPortfolioPayload({ name: 'Brokerage' }),
    raw: true,
  });
  const tx = await createExpense({ accountId, amount: 200 });
  await helpers.linkTransactionToPortfolio({ transactionId: tx.id, payload: { portfolioId: portfolio.id }, raw: true });
  return tx;
};

const createVentureLinked = async ({ accountId }: { accountId: RecordId }) => {
  const deal = await helpers.createVentureDeal({
    payload: helpers.buildVentureDealPayload({ name: 'SK 116', currencyCode: global.BASE_CURRENCY.code }),
    raw: true,
  });
  // principal 16000 + 8.5% entry fee: a linked initial investment must match it.
  const tx = await createExpense({ accountId, amount: 17360 });
  await helpers.createVentureEvent({
    dealId: deal.id,
    payload: {
      type: VENTURE_EVENT_TYPE.initial_investment,
      eventDate: '2026-03-24',
      cashFlowMode: VENTURE_CASH_FLOW_MODE.linked,
      transactionIds: [tx.id],
    },
    raw: true,
  });
  return tx;
};

const createPaymentMain = async ({ accountId, legAccountId }: { accountId: RecordId; legAccountId: RecordId }) => {
  const [main] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId,
      amount: 70,
      paymentLegs: [{ accountId: legAccountId, amount: 30 }],
    }),
    raw: true,
  });
  return main!;
};

describe('Transactions Trash: rows that must be unlinked first', () => {
  it('rejects deleting a portfolio-linked transaction until it is unlinked', async () => {
    const account = await createAccount();
    const tx = await createPortfolioLinked({ accountId: account.id });

    expect((await helpers.deleteTransaction({ id: tx.id })).statusCode).toBe(ERROR_CODES.ValidationError);
    expect(await helpers.getTransactionById({ id: tx.id, raw: true })).not.toBeNull();
    expect(await helpers.getTrash({ raw: true })).toEqual([]);

    expect((await helpers.unlinkTransactionFromPortfolio({ transactionId: tx.id })).statusCode).toBe(204);
    expect((await helpers.deleteTransaction({ id: tx.id })).statusCode).toBe(200);
    expect((await helpers.getTrash({ raw: true })).map((entry) => entry.id)).toEqual([tx.id]);
  });

  it('rejects deleting a venture-linked transaction', async () => {
    const account = await createAccount();
    const tx = await createVentureLinked({ accountId: account.id });

    expect((await helpers.deleteTransaction({ id: tx.id })).statusCode).toBe(ERROR_CODES.ValidationError);
    expect(await helpers.getTransactionById({ id: tx.id, raw: true })).not.toBeNull();
    expect(await helpers.getTrash({ raw: true })).toEqual([]);
  });

  it('rejects deleting a payment main row and its legs', async () => {
    const [card, voucher] = [await createAccount(), await createAccount()];
    const main = await createPaymentMain({ accountId: card.id, legAccountId: voucher.id });
    const [leg] = await helpers.getTransactions({ accountIds: [voucher.id], raw: true });

    expect((await helpers.deleteTransaction({ id: main.id })).statusCode).toBe(ERROR_CODES.ValidationError);
    expect((await helpers.deleteTransaction({ id: leg!.id })).statusCode).toBe(ERROR_CODES.ValidationError);
    expect(await helpers.getTrash({ raw: true })).toEqual([]);
  });

  it('bulk-trashes what it can and reports the rows it skipped', async () => {
    const [card, voucher] = [await createAccount(), await createAccount()];
    const plain = await createExpense({ accountId: card.id, amount: 10 });
    const portfolioTx = await createPortfolioLinked({ accountId: card.id });
    const ventureTx = await createVentureLinked({ accountId: card.id });
    const main = await createPaymentMain({ accountId: card.id, legAccountId: voucher.id });
    const balanceBefore = Number((await helpers.getAccount({ id: card.id, raw: true })).currentBalance);

    const result = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: [plain.id, portfolioTx.id, ventureTx.id, main.id] },
      raw: true,
    });

    expect(result.deletedCount).toBe(1);
    expect(result.deletedIds).toEqual([plain.id]);
    expect(result.skippedIds.toSorted()).toEqual([portfolioTx.id, ventureTx.id, main.id].toSorted());
    expect((await helpers.getTrash({ raw: true })).map((entry) => entry.id)).toEqual([plain.id]);
    expect(Number((await helpers.getAccount({ id: card.id, raw: true })).currentBalance)).toBe(balanceBefore + 10);
  });

  it('bulk-trashes both legs of a selected transfer once', async () => {
    const [checking, savings] = [await createAccount(), await createAccount()];
    const [from, to] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: checking.id, amount: 100 }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 100,
        destinationAccountId: savings.id,
      },
      raw: true,
    });

    const result = await helpers.bulkDeleteTransactions({
      payload: { transactionIds: [from.id, to!.id] },
      raw: true,
    });

    expect(result.skippedIds).toEqual([]);
    const entries = await helpers.getTrash({ raw: true });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.transactions.map((row) => row.id).toSorted()).toEqual([from.id, to!.id].toSorted());
  });
});

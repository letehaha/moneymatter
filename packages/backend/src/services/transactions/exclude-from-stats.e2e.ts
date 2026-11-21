import { API_RESPONSE_STATUS, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import * as helpers from '@tests/helpers';

/**
 * The reporting opt-out travels the whole write path: create with the flag, read it back, clear
 * it with an update. It must never change what the ledger holds — only what the reports count.
 */
const createTx = async ({ excludeFromStats }: { excludeFromStats?: boolean }) => {
  const account = await helpers.createAccount({ raw: true });

  return helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      ...(excludeFromStats === undefined ? {} : { excludeFromStats }),
    },
    raw: true,
  });
};

describe('excludeFromStats on the transaction write path', () => {
  it('persists the flag on create and leaves it off when the caller omits it', async () => {
    const [flagged] = await createTx({ excludeFromStats: true });
    const [plain] = await createTx({});

    expect(flagged.excludeFromStats).toBe(true);
    expect(plain.excludeFromStats).toBe(false);
  }, 30_000);

  it('PUT /transactions/:id clears and re-sets the flag, and the response carries it', async () => {
    const [tx] = await createTx({ excludeFromStats: true });

    const cleared = await helpers.makeRequest<TransactionApiResponse[]>({
      method: 'put',
      url: `/transactions/${tx.id}`,
      payload: { excludeFromStats: false },
    });

    expect(cleared.statusCode).toBe(200);
    expect(cleared.body).toMatchObject({ status: API_RESPONSE_STATUS.success });
    expect(cleared.body.response[0]!.excludeFromStats).toBe(false);

    const readBack = await helpers.getTransactionById({ id: tx.id, raw: true });
    expect(readBack?.excludeFromStats).toBe(false);

    const reFlagged = await helpers.makeRequest({
      method: 'put',
      url: `/transactions/${tx.id}`,
      payload: { excludeFromStats: true },
    });

    expect(reFlagged.statusCode).toBe(200);
    expect((await helpers.getTransactionById({ id: tx.id, raw: true }))?.excludeFromStats).toBe(true);
  }, 30_000);

  it('leaves the flag alone when an update does not mention it', async () => {
    const [tx] = await createTx({ excludeFromStats: true });

    const updated = await helpers.makeRequest({
      method: 'put',
      url: `/transactions/${tx.id}`,
      payload: { note: 'A note' },
    });

    expect(updated.statusCode).toBe(200);
    expect((await helpers.getTransactionById({ id: tx.id, raw: true }))?.excludeFromStats).toBe(true);
  }, 30_000);

  it('accepts the flag on a transfer leg and round-trips it', async () => {
    const account = await helpers.createAccount({ raw: true });
    const destination = await helpers.createAccount({ raw: true });

    const [base, opposite] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: destination.id,
          destinationAmount: 100,
        }),
        excludeFromStats: true,
      },
      raw: true,
    });

    expect(base.excludeFromStats).toBe(true);
    expect(opposite!.excludeFromStats).toBe(false);

    const updated = await helpers.makeRequest({
      method: 'put',
      url: `/transactions/${opposite!.id}`,
      payload: { excludeFromStats: true },
    });

    expect(updated.statusCode).toBe(200);
    expect((await helpers.getTransactionById({ id: opposite!.id, raw: true }))?.excludeFromStats).toBe(true);
  }, 30_000);

  it('copies the flag from the main row onto its payment legs', async () => {
    const card = await helpers.createAccount({ raw: true });
    const voucher = await helpers.createAccount({ raw: true });
    const [main] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: card.id,
        amount: 70,
        transactionType: TRANSACTION_TYPES.expense,
        paymentLegs: [{ accountId: voucher.id, amount: 30 }],
      }),
      raw: true,
    });
    const [leg] = (await helpers.getTransactions({ accountIds: [voucher.id], raw: true })).filter(
      (tx) => tx.paymentParentId,
    );
    const legFlag = async () => (await helpers.getTransactionById({ id: leg!.id, raw: true }))?.excludeFromStats;

    expect(await legFlag()).toBe(false);

    await helpers.updateTransaction({ id: main.id, payload: { excludeFromStats: true } });
    expect(await legFlag()).toBe(true);

    await helpers.updateTransaction({ id: main.id, payload: { excludeFromStats: false } });
    expect(await legFlag()).toBe(false);
  }, 30_000);
});

import { API_ERROR_CODES, API_RESPONSE_STATUS, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
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

    const cleared = await helpers.makeRequest<TransactionApiResponse>({
      method: 'put',
      url: `/transactions/${tx.id}`,
      payload: { excludeFromStats: false },
    });

    expect(cleared.statusCode).toBe(API_RESPONSE_STATUS.success);
    expect(cleared.body).toMatchObject({ status: API_RESPONSE_STATUS.success });
    expect((cleared.body as { response: TransactionApiResponse }).response.excludeFromStats).toBe(false);

    const readBack = await helpers.getTransactionById({ id: tx.id, raw: true });
    expect(readBack?.excludeFromStats).toBe(false);

    const reFlagged = await helpers.makeRequest({
      method: 'put',
      url: `/transactions/${tx.id}`,
      payload: { excludeFromStats: true },
    });

    expect(reFlagged.statusCode).toBe(API_RESPONSE_STATUS.success);
    expect((await helpers.getTransactionById({ id: tx.id, raw: true }))?.excludeFromStats).toBe(true);
  }, 30_000);

  it('leaves the flag alone when an update does not mention it', async () => {
    const [tx] = await createTx({ excludeFromStats: true });

    const updated = await helpers.makeRequest({
      method: 'put',
      url: `/transactions/${tx.id}`,
      payload: { note: 'A note' },
    });

    expect(updated.statusCode).toBe(API_RESPONSE_STATUS.success);
    expect((await helpers.getTransactionById({ id: tx.id, raw: true }))?.excludeFromStats).toBe(true);
  }, 30_000);

  it('rejects the flag on a transfer leg, which is outside every report anyway', async () => {
    const account = await helpers.createAccount({ raw: true });
    const destination = await helpers.createAccount({ raw: true });

    const response = await helpers.createTransaction({
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
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    const errorBody = (response as helpers.CustomResponse<unknown>).body.response as {
      code: string;
      message: string;
    };
    expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
    expect(errorBody.message).toMatch(/transfer/i);
  }, 30_000);

  it('rejects the flag when a transaction is turned into a transfer', async () => {
    const destination = await helpers.createAccount({ raw: true });
    const [tx] = await createTx({ excludeFromStats: false });

    const response = await helpers.makeRequest({
      method: 'put',
      url: `/transactions/${tx.id}`,
      payload: {
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAccountId: destination.id,
        destinationAmount: 100,
        excludeFromStats: true,
      },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    const errorBody = (response as helpers.CustomResponse<unknown>).body.response as {
      code: string;
      message: string;
    };
    expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
    expect(errorBody.message).toMatch(/transfer/i);
  }, 30_000);
});

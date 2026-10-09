import { TRANSACTION_TYPES } from '@bt/shared/types';
import { VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const createLinkedTransaction = async () => {
  const account = await helpers.createAccount({ raw: true });
  const deal = await helpers.createVentureDeal({
    payload: helpers.buildVentureDealPayload({ name: 'SK 116', currencyCode: global.BASE_CURRENCY.code }),
    raw: true,
  });
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      // principal 16000 + 8.5% entry fee: a linked initial investment must match it.
      amount: 17360,
      transactionType: TRANSACTION_TYPES.expense,
    }),
    raw: true,
  });
  await helpers.createVentureEvent({
    dealId: deal.id,
    payload: {
      type: VENTURE_EVENT_TYPE.initial_investment,
      eventDate: '2026-03-24',
      cashFlowMode: VENTURE_CASH_FLOW_MODE.linked,
      transactionIds: [tx!.id],
    },
    raw: true,
  });

  return { deal, tx: tx! };
};

describe('GET /transactions/:transactionId/venture-link', () => {
  it('returns the deal and event behind a venture-linked transaction', async () => {
    const { deal, tx } = await createLinkedTransaction();

    const link = await helpers.getTransactionVentureLink({ transactionId: tx.id, raw: true });

    expect(link).toEqual({
      dealId: deal.id,
      dealName: 'SK 116',
      isDealDeleted: false,
    });
  });

  it('flags a soft-deleted deal while still resolving its name', async () => {
    const { deal, tx } = await createLinkedTransaction();

    await helpers.deleteVentureDeal({ dealId: deal.id });

    const link = await helpers.getTransactionVentureLink({ transactionId: tx.id, raw: true });

    expect(link).toMatchObject({ dealId: deal.id, dealName: 'SK 116', isDealDeleted: true });
  });

  it('returns 404 for a transaction with no venture link', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id }),
      raw: true,
    });

    const response = await helpers.getTransactionVentureLink({ transactionId: tx!.id });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it("returns 404 for another user's linked transaction", async () => {
    const { tx } = await createLinkedTransaction();
    const { cookies } = await helpers.provisionSecondUserWithBaseCurrency();

    const response = await helpers.asUser({
      cookies,
      fn: () => helpers.getTransactionVentureLink({ transactionId: tx.id }),
    });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('returns 404 for an unknown transaction', async () => {
    const response = await helpers.getTransactionVentureLink({ transactionId: generateRandomRecordId() });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});

import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const createLinkedEvent = async ({ amount }: { amount: number }) => {
  const account = await helpers.createAccount({ raw: true });
  const deal = await helpers.createVentureDeal({
    payload: helpers.buildVentureDealPayload({ name: 'SK 116', currencyCode: global.BASE_CURRENCY.code }),
    raw: true,
  });
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      amount,
      transactionType: TRANSACTION_TYPES.expense,
    }),
    raw: true,
  });
  const event = await helpers.createVentureEvent({
    dealId: deal.id,
    payload: {
      type: VENTURE_EVENT_TYPE.initial_investment,
      eventDate: '2026-03-24',
      cashFlowMode: VENTURE_CASH_FLOW_MODE.linked,
      transactionIds: [tx!.id],
    },
    raw: true,
  });

  return { event, tx: tx! };
};

describe('DELETE /venture/events/:id/links/:linkId', () => {
  it('restores the transaction from the snapshot taken when it was linked', async () => {
    const { event, tx } = await createLinkedEvent({ amount: 17360 });
    const [link] = event.links ?? [];

    const response = await helpers.deleteEventLink({ eventId: event.id, linkId: link!.id });

    expect(response.statusCode).toBe(200);
    expect(helpers.extractResponse(response)).toEqual({ success: true });

    const restored = await helpers.getTransactionById({ id: tx.id, raw: true });
    expect(restored!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
    expect(restored!.amount).toBe(17360);
    expect(restored!.refAmount).toBe(17360);
  });

  it('returns 404 for an unknown link', async () => {
    const { event } = await createLinkedEvent({ amount: 17360 });

    const response = await helpers.deleteEventLink({ eventId: event.id, linkId: generateRandomRecordId() });

    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });
});

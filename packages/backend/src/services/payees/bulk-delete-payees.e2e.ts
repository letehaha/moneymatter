import { type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { generateRandomRecordId, NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

const createPayee = ({ name }: { name: string }) =>
  helpers.createPayee({ payload: helpers.buildPayeePayload({ name }), raw: true });

const buildRule = ({ name, payeeId }: { name: string; payeeId: string }) =>
  helpers.createAutomation({
    payload: {
      name,
      conditions: { match: 'all', items: [{ field: 'note', operator: 'contains_any', value: ['uber'] }] },
      actions: [{ type: 'set_payee', payeeId: payeeId as RecordId }],
    },
    raw: true,
  });

describe('POST /payees/bulk-delete', () => {
  it('deletes every selected payee, leaves the rest, and unlinks their transactions', async () => {
    const account = await helpers.createAccount({ raw: true });
    const first = await createPayee({ name: 'Bulk One' });
    const second = await createPayee({ name: 'Bulk Two' });
    const kept = await createPayee({ name: 'Bulk Kept' });
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
        transactionType: TRANSACTION_TYPES.expense,
        payeeId: first.id,
      }),
      raw: true,
    });

    const result = await helpers.bulkDeletePayees({ ids: [first.id, second.id], raw: true });

    expect(result).toEqual({ deletedCount: 2, ignoredAddedCount: 0 });
    const remainingIds = (await helpers.listPayees({ raw: true })).map((p) => p.id);
    expect(remainingIds).toContain(kept.id);
    expect(remainingIds).not.toContain(first.id);
    expect(remainingIds).not.toContain(second.id);

    const refetched = await helpers.getTransactionById({ id: tx!.id, raw: true });
    expect(refetched!.payeeId).toBeNull();

    expect(await helpers.listIgnoredNames({ raw: true })).toEqual([]);
  });

  it('adds every deleted name to the ignored list when ignoreFuture is set', async () => {
    const first = await createPayee({ name: 'Ignore Me' });
    const second = await createPayee({ name: 'Ignore Me Too' });

    const result = await helpers.bulkDeletePayees({ ids: [first.id, second.id], ignoreFuture: true, raw: true });

    expect(result).toEqual({ deletedCount: 2, ignoredAddedCount: 2 });
    const ignored = (await helpers.listIgnoredNames({ raw: true })).map((row) => row.normalizedName).toSorted();
    expect(ignored).toEqual(['ignore me', 'ignore me too']);
    expect(await helpers.listPayees({ raw: true })).toEqual([]);
  });

  it('pauses automations that reference a deleted payee and leaves others running', async () => {
    const gone = await createPayee({ name: 'Automation Gone' });
    const kept = await createPayee({ name: 'Automation Kept' });
    const goneRule = await buildRule({ name: 'gone rule', payeeId: gone.id });
    const keptRule = await buildRule({ name: 'kept rule', payeeId: kept.id });

    await helpers.bulkDeletePayees({ ids: [gone.id], raw: true });

    const paused = await helpers.getAutomationById({ id: goneRule.id });
    expect(paused?.isEnabled).toBe(false);
    expect(paused?.pausedReason).toMatchObject({ kind: 'missing_reference', refType: 'payee', refId: gone.id });
    expect((await helpers.getAutomationById({ id: keptRule.id }))?.isEnabled).toBe(true);
  });

  it('rejects an empty id list', async () => {
    const res = await helpers.bulkDeletePayees({ ids: [], raw: false });
    expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('rejects more than 2000 ids', async () => {
    const ids = Array.from({ length: 2001 }, () => generateRandomRecordId());
    const res = await helpers.bulkDeletePayees({ ids, raw: false });
    expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('rejects duplicate ids', async () => {
    const payee = await createPayee({ name: 'Duplicated' });
    const res = await helpers.bulkDeletePayees({ ids: [payee.id, payee.id], raw: false });
    expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
  });

  it('deletes nothing when one id does not exist', async () => {
    const payee = await createPayee({ name: 'Survivor' });

    const res = await helpers.bulkDeletePayees({ ids: [payee.id, NONEXISTENT_ID], raw: false });

    expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    const still = await helpers.getPayeeById({ id: payee.id, raw: false });
    expect(still.statusCode).toBe(200);
  });
});

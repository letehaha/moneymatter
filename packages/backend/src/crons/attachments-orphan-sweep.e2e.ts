import type { RecordId } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { attachmentsOrphanSweepCron } from '@root/crons/attachments-orphan-sweep';
import { deleteObject, listObjects, putObject, storageKey } from '@services/attachments/storage';
import * as helpers from '@tests/helpers';
import { v7 as uuidv7 } from 'uuid';

/** The sweep has no HTTP surface, so this e2e invokes it directly. */

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const attachTo = async ({ accountId }: { accountId: RecordId }) => {
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId }),
    raw: true,
  });
  const uploaded = await helpers.uploadAttachment({ transactionId: tx!.id, file: PNG_BYTES });
  expect(uploaded.statusCode).toBe(201);
  return { transactionId: tx!.id, attachmentId: uploaded.response!.id };
};

const storedIds = async () => (await listObjects()).map((object) => object.key.split('/')[1]);

// The storage root is a tmp dir shared by every test in this jest worker.
beforeEach(async () => {
  for (const object of await listObjects()) await deleteObject({ key: object.key });
});

describe('Attachments orphan sweep', () => {
  it('deletes a blob whose row is gone and keeps one whose row is alive', async () => {
    const account = await helpers.createAccount({ raw: true });
    const orphaned = await attachTo({ accountId: account.id });
    const live = await attachTo({ accountId: account.id });

    expect((await helpers.deleteTransaction({ id: orphaned.transactionId })).statusCode).toBe(200);

    const result = await attachmentsOrphanSweepCron.triggerManualSync({ minAgeMs: 0 });

    expect(result).toEqual({ deleted: 1, scanned: 2 });
    expect(await storedIds()).toEqual([live.attachmentId]);
  });

  it('leaves a fresh orphan alone under the default minimum age', async () => {
    const account = await helpers.createAccount({ raw: true });
    const orphaned = await attachTo({ accountId: account.id });

    expect((await helpers.deleteTransaction({ id: orphaned.transactionId })).statusCode).toBe(200);

    const result = await attachmentsOrphanSweepCron.triggerManualSync();

    expect(result).toEqual({ deleted: 0, scanned: 0 });
    expect(await storedIds()).toEqual([orphaned.attachmentId]);
  });

  it('refuses a sweep that would remove most of the bucket and deletes nothing', async () => {
    const account = await helpers.createAccount({ raw: true });
    const live = await attachTo({ accountId: account.id });

    for (let i = 0; i < 51; i++) {
      await putObject({
        key: storageKey({ userId: 999, id: uuidv7() }),
        body: PNG_BYTES,
        contentType: 'image/png',
      });
    }

    await expect(attachmentsOrphanSweepCron.triggerManualSync({ minAgeMs: 0 })).rejects.toThrow(
      /orphan sweep aborted/i,
    );

    const remaining = await storedIds();
    expect(remaining).toHaveLength(52);
    expect(remaining).toContain(live.attachmentId);
  });
});

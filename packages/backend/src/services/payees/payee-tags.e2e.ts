import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

async function createTag(name: string) {
  return helpers.createTag({
    payload: helpers.buildTagPayload({ name }),
    raw: true,
  });
}

describe('Payee default tags', () => {
  describe('PATCH /payees/:id (defaultTagIds)', () => {
    it('sets, validates, cascades, and clears the default tag set', async () => {
      const [tagA, tagB, payee] = await Promise.all([
        createTag('Tag A'),
        createTag('Tag B'),
        helpers.createPayee({
          payload: helpers.buildPayeePayload({ name: 'Amazon' }),
          raw: true,
        }),
      ]);

      const updated = await helpers.updatePayee({
        id: payee.id,
        payload: { defaultTagIds: [tagA.id, tagB.id] },
        raw: true,
      });
      expect(updated.defaultTagIds).toHaveLength(2);
      expect(updated.defaultTagIds).toEqual(expect.arrayContaining([tagA.id, tagB.id]));

      const foreignTag = await helpers.updatePayee({
        id: payee.id,
        payload: { defaultTagIds: [generateRandomRecordId()] },
        raw: false,
      });
      expect(foreignTag.statusCode).toBe(ERROR_CODES.ValidationError);

      await helpers.deleteTag({ id: tagA.id, raw: true });
      const reloaded = await helpers.getPayeeById({ id: payee.id, raw: true });
      expect(reloaded.defaultTagIds).toEqual([tagB.id]);

      const cleared = await helpers.updatePayee({
        id: payee.id,
        payload: { defaultTagIds: [] },
        raw: true,
      });
      expect(cleared.defaultTagIds).toEqual([]);
    }, 30000);
  });

  describe('auto-apply on transaction creation', () => {
    it('auto-applies only when the payee has a rule and the caller sent no tag list', async () => {
      const [autoTag, manualTag] = await Promise.all([createTag('Auto'), createTag('Manual')]);
      const [ruled, ruleless, account] = await Promise.all([
        helpers.createPayee({
          payload: helpers.buildPayeePayload({
            name: 'Amazon',
            defaultTagIds: [autoTag.id],
          }),
          raw: true,
        }),
        helpers.createPayee({
          payload: helpers.buildPayeePayload({ name: 'Ruleless Co' }),
          raw: true,
        }),
        helpers.createAccount({ raw: true }),
      ]);

      const [noTagList] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          payeeId: ruled.id,
        }),
        raw: true,
      });
      const [explicitTagList] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          payeeId: ruled.id,
          tagIds: [manualTag.id],
        }),
        raw: true,
      });
      const [explicitEmptyTagList] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          payeeId: ruled.id,
          tagIds: [],
        }),
        raw: true,
      });
      const [rulelessTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          payeeId: ruleless.id,
        }),
        raw: true,
      });

      const list = await helpers.getTransactions({
        raw: true,
      });
      const tagsOf = (id: string) => list.find((item) => item.id === id)?.tags?.map((t) => t.id) ?? [];

      expect(tagsOf(noTagList.id)).toEqual([autoTag.id]);
      expect(tagsOf(explicitTagList.id)).toEqual([manualTag.id]);
      expect(tagsOf(explicitEmptyTagList.id)).toEqual([]);
      expect(tagsOf(rulelessTx.id)).toEqual([]);
    }, 30000);
  });

  describe('auto-apply via extraction matching (no caller payeeId)', () => {
    // The HTTP create endpoint doesn't accept `rawMerchantName` — bank sync
    // calls the service layer with it. The note-fallback flag routes `note`
    // through the exact same `resolvePayeeForRawMerchant` → auto-tag path,
    // so this is the e2e-reachable proxy for provider syncs (same pattern as
    // extraction-from-note.e2e.ts).
    it('applies default tags on a canonical or alias match, merged on top of caller tags', async () => {
      await helpers.updateUserSettings({
        settings: { locale: 'en', payeeExtractionUsesDescription: true },
      });

      const [autoTag, manualTag] = await Promise.all([createTag('Auto'), createTag('Manual')]);
      const [payee, account] = await Promise.all([
        helpers.createPayee({
          payload: helpers.buildPayeePayload({
            name: 'Spotify',
            defaultTagIds: [autoTag.id],
          }),
          raw: true,
        }),
        helpers.createAccount({ raw: true }),
      ]);
      await helpers.createPayeeAlias({
        payeeId: payee.id,
        rawName: 'SPOTIFY AB Stockholm',
        raw: true,
      });

      // No payeeId, no tagIds — Step 1 exact match on the note links the payee.
      const [canonicalTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          note: 'Spotify',
        }),
        raw: true,
      });
      expect(canonicalTx.payeeId).toBe(payee.id);

      const [callerTaggedTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          note: 'Spotify',
          tagIds: [manualTag.id],
        }),
        raw: true,
      });
      expect(callerTaggedTx.payeeId).toBe(payee.id);

      const [aliasTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          note: 'SPOTIFY AB Stockholm',
        }),
        raw: true,
      });
      expect(aliasTx.payeeId).toBe(payee.id);

      const list = await helpers.getTransactions({
        raw: true,
      });
      const tagsOf = (id: string) => list.find((item) => item.id === id)?.tags?.map((t) => t.id) ?? [];

      expect(tagsOf(canonicalTx.id)).toEqual([autoTag.id]);
      expect(tagsOf(callerTaggedTx.id).sort()).toEqual([autoTag.id, manualTag.id].sort());
      expect(tagsOf(aliasTx.id)).toEqual([autoTag.id]);
    }, 30000);
  });

  describe('POST /payees/:id/apply-tags', () => {
    it('retroactively tags all transactions of the payee (add-only, idempotent)', async () => {
      const [tagA, manualTag] = await Promise.all([createTag('Tag A'), createTag('Manual')]);
      const [payee, account] = await Promise.all([
        helpers.createPayee({
          payload: helpers.buildPayeePayload({ name: 'Amazon' }),
          raw: true,
        }),
        helpers.createAccount({ raw: true }),
      ]);

      // Two payee-linked rows created before the rule exists: one untagged, one
      // already carrying a manual tag. A third row without the payee must stay out.
      const [taggedTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          payeeId: payee.id,
          tagIds: [manualTag.id],
        }),
        raw: true,
      });
      const [untaggedTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          payeeId: payee.id,
          tagIds: [],
        }),
        raw: true,
      });
      const [unrelatedTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });

      await helpers.updatePayee({
        id: payee.id,
        payload: { defaultTagIds: [tagA.id] },
        raw: true,
      });

      const result = await helpers.applyPayeeTagsToExisting({
        id: payee.id,
        raw: true,
      });
      expect(result.updatedTransactionsCount).toBe(2);

      const list = await helpers.getTransactions({
        raw: true,
      });
      const tagsOf = (id: string) => list.find((item) => item.id === id)?.tags?.map((t) => t.id) ?? [];
      expect(tagsOf(taggedTx.id)).toEqual(expect.arrayContaining([manualTag.id, tagA.id]));
      expect(tagsOf(taggedTx.id)).toHaveLength(2);
      expect(tagsOf(untaggedTx.id)).toEqual([tagA.id]);
      expect(tagsOf(unrelatedTx.id)).toEqual([]);

      // Second run finds nothing new.
      const secondRun = await helpers.applyPayeeTagsToExisting({
        id: payee.id,
        raw: true,
      });
      expect(secondRun.updatedTransactionsCount).toBe(0);
    });

    it('returns zero when the payee has no default tags, and 404 for an unknown payee', async () => {
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: 'Amazon' }),
        raw: true,
      });

      const result = await helpers.applyPayeeTagsToExisting({
        id: payee.id,
        raw: true,
      });
      expect(result.updatedTransactionsCount).toBe(0);

      const unknown = await helpers.applyPayeeTagsToExisting({
        id: generateRandomRecordId(),
        raw: false,
      });
      expect(unknown.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('merge', () => {
    it('unions the source default tags into the target', async () => {
      const [tagA, tagB] = await Promise.all([createTag('Tag A'), createTag('Tag B')]);
      const [source, target] = await Promise.all([
        helpers.createPayee({
          payload: helpers.buildPayeePayload({
            name: 'Source',
            defaultTagIds: [tagA.id, tagB.id],
          }),
          raw: true,
        }),
        helpers.createPayee({
          payload: helpers.buildPayeePayload({
            name: 'Target',
            defaultTagIds: [tagB.id],
          }),
          raw: true,
        }),
      ]);

      const merged = await helpers.mergePayees({
        sourceId: source.id,
        targetId: target.id,
        raw: true,
      });

      expect(merged.defaultTagIds).toHaveLength(2);
      expect(merged.defaultTagIds).toEqual(expect.arrayContaining([tagA.id, tagB.id]));
    });
  });
});

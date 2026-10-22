/**
 * Shared tracker stats — recipient-attached transactions contribute to the
 * tracker-level numbers and the spending-by-category breakdown.
 *
 * Pre-existing tests in `shared-tracker-visibility.service.e2e.ts` cover the parity
 * case (owner txs only, recipient sees same numbers). This file fills the gap that
 * MVP discovered: when a `write` recipient attaches their own transactions to a
 * tracker, those rows now count in stats / spending-stats / the tracker tx list,
 * and category breakdowns merge across users by `Categories.key`.
 */

import { type RecordId, RESOURCE_TYPES, SHARE_PERMISSIONS, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import Categories from '@models/categories.model';
import * as helpers from '@tests/helpers';

// ---------------------------------------------------------------------------
// Scaffold helpers (mirrors shared-tracker-writes.service.e2e.ts)
// ---------------------------------------------------------------------------

interface ShareTrackerParams {
  trackerId: string;
  recipient: helpers.SecondUserHandle;
  permission: (typeof SHARE_PERMISSIONS)[keyof typeof SHARE_PERMISSIONS];
}

async function shareTracker({ trackerId, recipient, permission }: ShareTrackerParams): Promise<void> {
  const invitation = await helpers.createShareInvitation({
    inviteeEmail: recipient.email,
    resourceType: RESOURCE_TYPES.tracker,
    resourceId: trackerId,
    permission,
    raw: true,
  });
  await helpers.asUser({
    cookies: recipient.cookies,
    fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
  });
}

/** Convenience: create a tx owned by the supplied recipient and return it. Each call
 *  creates a fresh recipient-owned account + (unless a `categoryId` is passed) a fresh
 *  recipient-owned custom category, so the tx never falls back to `DEFAULT_CATEGORY_ID`
 *  (which belongs to the test owner and would 404 for the recipient). */
async function recipientCreatesTx({
  cookies,
  amount,
  transactionType = TRANSACTION_TYPES.expense,
  categoryId,
}: {
  cookies: string;
  amount: number;
  transactionType?: TRANSACTION_TYPES;
  categoryId?: RecordId;
}) {
  const account = await helpers.asUser({
    cookies,
    fn: () => helpers.createAccount({ raw: true }),
  });

  const effectiveCategoryId: RecordId =
    categoryId ??
    (
      await helpers.asUser({
        cookies,
        fn: () =>
          helpers.addCustomCategory({
            name: `r-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            color: '#888888',
            raw: true,
          }),
      })
    ).id;

  const [tx] = await helpers.asUser({
    cookies,
    fn: () =>
      helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount,
          transactionType,
          categoryId: effectiveCategoryId,
        }),
        raw: true,
      }),
  });
  return tx!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Shared tracker stats with recipient transactions', () => {
  describe('GET /trackers/:id/stats — totals include recipient txs', () => {
    it("recipient's attached tx contributes to actualExpense / balance / transactionsCount", async () => {
      // Owner side: one expense of 100, refAmount = 100 in base currency.
      const ownerAccount = await helpers.createAccount({ raw: true });
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: ownerAccount.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const tracker = await helpers.createTracker({
        name: 'Stats with recipient',
        limitAmount: 1000,
        raw: true,
      });

      await helpers.addTransactionsToTracker({
        id: tracker.id,
        payload: { transactionIds: [ownerTx!.id] },
        raw: false,
      });

      // Recipient with write permission attaches their own 50-expense tx.
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareTracker({
        trackerId: tracker.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
      });
      const recipientTx = await recipientCreatesTx({
        cookies: recipient.cookies,
        amount: 50,
      });

      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.addTransactionsToTracker({
            id: tracker.id,
            payload: { transactionIds: [recipientTx.id] },
            raw: false,
          }),
      });

      // Owner-side stats: both contributions counted.
      const ownerStats = await helpers.getTrackerStats({
        id: tracker.id,
        raw: true,
      });
      expect(ownerStats!.summary.actualExpense).toBe(150);
      expect(ownerStats!.summary.balance).toBe(-150);
      expect(ownerStats!.summary.transactionsCount).toBe(2);
      // 150 / 1000 * 100 = 15; recipient spend counts against the owner-defined limit.
      expect(ownerStats!.summary.utilizationRate).toBe(15);

      // Recipient-side stats: same numbers — both viewers see the full picture.
      const recipientStats = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTrackerStats({ id: tracker.id, raw: true }),
      });
      expect(JSON.stringify(ownerStats)).toBe(JSON.stringify(recipientStats));
    });
  });

  describe('GET /trackers/:id/spending-stats — category breakdown across users', () => {
    it("recipient's seeded category folds into owner's matching key (displays owner's name/color)", async () => {
      // Owner has the seeded `transportation` category — `create-user-with-defaults`
      // seeds the standard set, so we just look it up rather than creating one.
      const ownerApp = await helpers.findAppUserByEmail({
        email: 'test1@test.local',
      });
      const ownerTaxi = (await Categories.findOne({
        where: { userId: ownerApp.id, key: 'transportation' },
        raw: true,
      })) as unknown as { id: RecordId; name: string; color: string } | null;
      if (!ownerTaxi) {
        throw new Error('Test setup: owner is missing seeded `transportation` category');
      }

      const ownerAccount = await helpers.createAccount({ raw: true });
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: ownerAccount.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: ownerTaxi.id,
        }),
        raw: true,
      });

      const tracker = await helpers.createTracker({
        name: 'Key-merge breakdown',
        limitAmount: 1000,
        raw: true,
      });
      await helpers.addTransactionsToTracker({
        id: tracker.id,
        payload: { transactionIds: [ownerTx!.id] },
        raw: false,
      });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareTracker({
        trackerId: tracker.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
      });

      // Recipient's matching seeded `transportation` category — different id, same key.
      const recipientAppUser = await helpers.findAppUserByEmail({
        email: recipient.email,
      });
      const recipientTrans = (await Categories.findOne({
        where: { userId: recipientAppUser.id, key: 'transportation' },
        raw: true,
      })) as unknown as { id: RecordId; name: string; color: string } | null;
      if (!recipientTrans) {
        throw new Error('Test setup: recipient is missing seeded `transportation` category');
      }
      // Sanity check — confirms the merge is non-trivial.
      expect(recipientTrans.id).not.toBe(ownerTaxi.id);

      const recipientTx = await recipientCreatesTx({
        cookies: recipient.cookies,
        amount: 50,
        categoryId: recipientTrans.id,
      });
      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.addTransactionsToTracker({
            id: tracker.id,
            payload: { transactionIds: [recipientTx.id] },
            raw: false,
          }),
      });

      const spendingStats = await helpers.getTrackerSpendingStats({
        id: tracker.id,
        raw: true,
      });
      const transportationBuckets = spendingStats!.spendingsByCategory.filter((row) => row.categoryId === ownerTaxi.id);
      // Both owner's 100 and recipient's 50 land in owner's transportation row.
      expect(transportationBuckets.length).toBe(1);
      expect(transportationBuckets[0]!.amount).toBe(150);
      expect(transportationBuckets[0]!.name).toBe(ownerTaxi.name);
    });

    it("recipient's null-key custom category buckets under a synthetic Other row", async () => {
      const tracker = await helpers.createTracker({
        name: 'Other-bucket breakdown',
        limitAmount: 1000,
        raw: true,
      });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareTracker({
        trackerId: tracker.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
      });

      // Recipient creates a CUSTOM category (key=null) and attaches a tx using it.
      const recipientCategory = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.addCustomCategory({
            name: 'Recipient Custom Gifts',
            color: '#ABCDEF',
            raw: true,
          }),
      });
      const recipientTx = await recipientCreatesTx({
        cookies: recipient.cookies,
        amount: 75,
        categoryId: recipientCategory.id,
      });
      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.addTransactionsToTracker({
            id: tracker.id,
            payload: { transactionIds: [recipientTx.id] },
            raw: false,
          }),
      });

      const spendingStats = await helpers.getTrackerSpendingStats({
        id: tracker.id,
        raw: true,
      });
      // The recipient-custom contribution lands in a synthetic "Other" bucket — not
      // surfaced as the recipient's category name (which would leak naming across the
      // share). The exact synthetic id is internal, so we assert by `name === 'Other'`.
      const otherRow = spendingStats!.spendingsByCategory.find((row) => row.name === 'Other');
      expect(otherRow).toBeDefined();
      expect(otherRow!.amount).toBe(75);
      // Crucially, the recipient's actual category does NOT appear as its own row.
      const leakedRow = spendingStats!.spendingsByCategory.find((row) => row.categoryId === recipientCategory.id);
      expect(leakedRow).toBeUndefined();
    });
  });

  describe('GET /transactions?trackerIds=X — addedBy metadata', () => {
    it('owner-attached row surfaces tracker owner; recipient-attached row surfaces recipient', async () => {
      // Both row flavours emit `addedBy` describing the attacher so the frontend can
      // hide the chip when viewer === attacher and show it otherwise.
      const ownerAccount = await helpers.createAccount({ raw: true });
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: ownerAccount.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const tracker = await helpers.createTracker({
        name: 'AddedBy enrichment',
        raw: true,
      });
      // Owner attaches their own tx — junction metadata stays null, but addedBy still
      // resolves to the tracker owner so a recipient viewing the row sees who put it
      // in the tracker.
      await helpers.addTransactionsToTracker({
        id: tracker.id,
        payload: { transactionIds: [ownerTx!.id] },
        raw: false,
      });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareTracker({
        trackerId: tracker.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
      });
      const recipientTx = await recipientCreatesTx({
        cookies: recipient.cookies,
        amount: 50,
      });
      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.addTransactionsToTracker({
            id: tracker.id,
            payload: { transactionIds: [recipientTx.id] },
            raw: false,
          }),
      });

      const ownerApp = await helpers.findAppUserByEmail({
        email: 'test1@test.local',
      });
      const recipientApp = await helpers.findAppUserByEmail({
        email: recipient.email,
      });

      const ownerRows = await helpers.getTransactions({
        trackerIds: [tracker.id],
        raw: true,
      });
      const ownerRowById = new Map(ownerRows.map((r) => [r.id, r as typeof r & { addedBy?: unknown }]));

      const ownerRowAddedBy = ownerRowById.get(ownerTx!.id)!.addedBy as {
        id: number;
        username: string;
      } | null;
      expect(ownerRowAddedBy).not.toBeNull();
      expect(ownerRowAddedBy!.id).toBe(ownerApp.id);

      const recipientRowAddedBy = ownerRowById.get(recipientTx.id)!.addedBy as {
        id: number;
        username: string;
      } | null;
      expect(recipientRowAddedBy).not.toBeNull();
      expect(recipientRowAddedBy!.id).toBe(recipientApp.id);
      expect(recipientRowAddedBy!.username).toBe(recipientApp.username);
    });

    it('recipient can fetch owner-attached rows via trackerIds even without account-share', async () => {
      // Pre-fix, the recipient would only see txs in their accessible accounts.
      // Owner's tx lives in owner's account (not shared) so it was invisible. Tracker-share
      // now widens visibility on a trackerIds-scoped fetch.
      const ownerAccount = await helpers.createAccount({ raw: true });
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: ownerAccount.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const tracker = await helpers.createTracker({
        name: 'Recipient sees owner tx via tracker',
        raw: true,
      });
      await helpers.addTransactionsToTracker({
        id: tracker.id,
        payload: { transactionIds: [ownerTx!.id] },
        raw: false,
      });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareTracker({
        trackerId: tracker.id,
        recipient,
        permission: SHARE_PERMISSIONS.read,
      });

      const rows = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTransactions({ trackerIds: [tracker.id], raw: true }),
      });

      const ids = rows.map((r) => r.id);
      expect(ids).toContain(ownerTx!.id);
    });

    it('GET /transactions WITHOUT trackerIds does not include addedBy at all', async () => {
      const account = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const rows = await helpers.getTransactions({ raw: true });
      // No tracker context ⇒ no enrichment ⇒ no `addedBy` property surfaces. The
      // serializer skips the field when it's not present on the model. Asserting
      // strict absence guards against accidental cross-pollination from a leaked
      // shared instance.
      const row = rows[0] as Record<string, unknown> | undefined;
      expect(row).toBeDefined();
      expect('addedBy' in row!).toBe(false);
    });
  });

  describe('Inaccessible trackerIds — silently dropped', () => {
    it('returns [] when caller filters by a tracker they have no share for', async () => {
      const otherOwner = await helpers.provisionSecondUserWithBaseCurrency();
      const otherTracker = await helpers.asUser({
        cookies: otherOwner.cookies,
        fn: () => helpers.createTracker({ name: 'Foreign tracker', raw: true }),
      });

      const rows = await helpers.getTransactions({
        trackerIds: [otherTracker.id],
        raw: true,
      });
      expect(rows).toEqual([]);
    });
  });
});

/**
 * Shared tracker visibility — recipient's read-only view of owner trackers.
 *
 * Covers GET /trackers (list) and GET /trackers/:id (detail) access control,
 * stats parity between owner and recipient, and the share block shape.
 */

import { ACCESS_SOURCES, RESOURCE_TYPES, SHARE_PERMISSIONS, TRANSACTION_TYPES } from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { CustomResponse } from '@tests/helpers/common';
import { addDays } from 'date-fns';

// ---------------------------------------------------------------------------
// Shared test scaffold helpers
// ---------------------------------------------------------------------------

interface ShareTrackerParams {
  trackerId: string;
  recipient: helpers.SecondUserHandle;
  permission: (typeof SHARE_PERMISSIONS)[keyof typeof SHARE_PERMISSIONS];
}

/** Owner shares a tracker and the recipient auto-accepts. Requires owner cookies in `global.APP_AUTH_COOKIES`. */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Shared tracker visibility', () => {
  describe('GET /trackers — list', () => {
    it("returns owner's own trackers with share.isOwner=true and accessSource='owner'", async () => {
      const tracker = await helpers.createTracker({
        name: 'Owner tracker',
        raw: true,
      });

      const trackers = await helpers.getTrackers({ raw: true });
      const found = (
        trackers as Array<{
          id: string;
          share?: { isOwner: boolean; accessSource: string };
        }>
      ).find((b) => b.id === tracker.id);
      expect(found).toBeDefined();
      expect(found!.share).toBeDefined();
      expect(found!.share!.isOwner).toBe(true);
      expect(found!.share!.accessSource).toBe(ACCESS_SOURCES.owner);
    });

    it("includes owner's shared tracker in recipient's tracker list", async () => {
      const tracker = await helpers.createTracker({
        name: 'Shared to recipient',
        raw: true,
      });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareTracker({
        trackerId: tracker.id,
        recipient,
        permission: SHARE_PERMISSIONS.read,
      });

      const trackers = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTrackers({ raw: true }),
      });

      type TrackerListItem = {
        id: string;
        share?: {
          isOwner: boolean;
          accessSource: string;
          permission: string;
          owner: { username: string };
        };
      };

      const found = (trackers as TrackerListItem[]).find((b) => b.id === tracker.id);
      expect(found).toBeDefined();
      expect(found!.share).toBeDefined();
      expect(found!.share!.isOwner).toBe(false);
      expect(found!.share!.accessSource).toBe(ACCESS_SOURCES.share);
      expect(found!.share!.permission).toBe(SHARE_PERMISSIONS.read);
      expect(found!.share!.owner.username).toBeTruthy();
    });
  });

  describe('no tracker access', () => {
    it('hides owner trackers from a stranger across list, detail, spending-stats and rules sync', async () => {
      const manualTracker = await helpers.createTracker({
        name: 'Private tracker',
        raw: true,
      });

      const category = await helpers.addCustomCategory({
        name: 'Cat-stranger',
        color: '#654321',
        raw: true,
      });
      const ownerAccount = await helpers.createAccount({ raw: true });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: ownerAccount.id,
          amount: 75,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: category.id,
        }),
        raw: true,
      });
      const categoryTracker = await helpers.createTracker({
        name: 'Category tracker stranger',
        rulesEnabled: true,
        categoryIds: [category.id],
        limitAmount: 500,
        raw: true,
      });

      const stranger = await helpers.provisionSecondUserWithBaseCurrency();

      const trackers = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => helpers.getTrackers({ raw: true }),
      });
      const visibleIds = (trackers as Array<{ id: string }>).map((b) => b.id);
      expect(visibleIds).not.toContain(manualTracker.id);
      expect(visibleIds).not.toContain(categoryTracker.id);

      const detailRes = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => helpers.getTrackerById({ id: manualTracker.id, raw: false }),
      });
      expect(detailRes.statusCode).toBe(ERROR_CODES.NotFoundError);

      const spendingRes = (await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => helpers.getTrackerSpendingStats({ id: manualTracker.id, raw: false }),
      })) as CustomResponse<unknown>;
      expect(spendingRes.statusCode).toBe(ERROR_CODES.NotFoundError);

      const syncRes = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => helpers.syncTrackerRules({ id: categoryTracker.id, raw: false }),
      });
      expect(syncRes.statusCode).toBe(ERROR_CODES.NotFoundError);

      const unknownIdRes = (await helpers.getTrackerSpendingStats({
        id: NONEXISTENT_ID,
        raw: false,
      })) as CustomResponse<unknown>;
      expect(unknownIdRes.statusCode).toBe(ERROR_CODES.NotFoundError);
    }, 30000);
  });

  describe('GET /trackers/:id — detail', () => {
    it('returns the shared tracker to a recipient with share block (isOwner=false)', async () => {
      const tracker = await helpers.createTracker({
        name: 'Shared detail',
        raw: true,
      });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareTracker({
        trackerId: tracker.id,
        recipient,
        permission: SHARE_PERMISSIONS.read,
      });

      const res = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTrackerById({ id: tracker.id, raw: false }),
      });

      expect(res.statusCode).toBe(200);
      const body = (
        res as unknown as CustomResponse<{
          id: string;
          share?: {
            isOwner: boolean;
            permission: string;
            accessSource: string;
          };
        }>
      ).body.response;
      expect(body.id).toBe(tracker.id);
      expect(body.share).toBeDefined();
      expect(body.share!.isOwner).toBe(false);
      expect(body.share!.permission).toBe(SHARE_PERMISSIONS.read);
      expect(body.share!.accessSource).toBe(ACCESS_SOURCES.share);
    });

    it('returns 404 on GET /trackers/:id after share is revoked', async () => {
      const tracker = await helpers.createTracker({
        name: 'Revoke test',
        raw: true,
      });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareTracker({
        trackerId: tracker.id,
        recipient,
        permission: SHARE_PERMISSIONS.read,
      });

      // Confirm recipient could access before revoke
      const before = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTrackerById({ id: tracker.id, raw: false }),
      });
      expect(before.statusCode).toBe(200);

      const recipientApp = await helpers.findAppUserByEmail({
        email: recipient.email,
      });
      await helpers.revokeShareMember({
        resourceType: RESOURCE_TYPES.tracker,
        resourceId: tracker.id,
        memberUserId: recipientApp.id,
        raw: true,
      });

      const after = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTrackerById({ id: tracker.id, raw: false }),
      });
      expect(after.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('GET /trackers/:id/stats — stats parity', () => {
    it('returns identical stats and spending-stats for owner and recipient on the same tracker', async () => {
      // Both endpoints run auth inside the service and resolve the owner's userId
      // internally; dropping the owner-scope switch would silently return empty
      // results to the recipient.
      const account = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 200,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: true,
      });

      const tracker = await helpers.createTracker({
        name: 'Stats parity tracker',
        limitAmount: 1000,
        raw: true,
      });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareTracker({
        trackerId: tracker.id,
        recipient,
        permission: SHARE_PERMISSIONS.read,
      });

      const ownerStats = await helpers.getTrackerStats({
        id: tracker.id,
        raw: true,
      });
      const recipientStats = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTrackerStats({ id: tracker.id, raw: true }),
      });

      // Both should get stats back (may be null if no transactions in tracker period,
      // but the shape must match regardless)
      expect(JSON.stringify(ownerStats)).toBe(JSON.stringify(recipientStats));

      const ownerSpending = await helpers.getTrackerSpendingStats({
        id: tracker.id,
        raw: true,
      });
      const recipientSpending = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTrackerSpendingStats({ id: tracker.id, raw: true }),
      });

      expect(JSON.stringify(ownerSpending)).toBe(JSON.stringify(recipientSpending));
    }, 30000);
  });

  describe("Owner's planned rows on a shared manual tracker", () => {
    it('counts the plan for the owner but keeps it out of the recipient stats and spending totals', async () => {
      const account = await helpers.createAccount({ raw: true });

      const [realTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-10T10:00:00Z',
        }),
        raw: true,
      });
      const [plannedTx] = await helpers.createPlannedTransaction({
        payload: {
          accountId: account.id,
          amount: 250,
          transactionType: TRANSACTION_TYPES.expense,
          time: '2025-03-20T10:00:00Z',
        },
        raw: true,
      });

      const tracker = await helpers.createTracker({
        name: 'Manual tracker with a plan',
        startDate: '2025-03-01T00:00:00Z',
        endDate: '2025-03-31T23:59:59Z',
        limitAmount: 1000,
        raw: true,
      });
      await helpers.addTransactionsToTracker({
        id: tracker.id,
        payload: { transactionIds: [realTx!.id, plannedTx!.id] },
      });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareTracker({
        trackerId: tracker.id,
        recipient,
        permission: SHARE_PERMISSIONS.read,
      });

      const ownerStats = (await helpers.getTrackerStats({
        id: tracker.id,
        raw: true,
      }))!;
      expect(ownerStats.summary.actualExpense).toBe(350);
      expect(ownerStats.summary.transactionsCount).toBe(2);

      const recipientStats = (await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTrackerStats({ id: tracker.id, raw: true }),
      }))!;
      expect(recipientStats.summary.actualExpense).toBe(100);
      expect(recipientStats.summary.transactionsCount).toBe(1);

      const ownerSpending = await helpers.getTrackerSpendingStats({
        id: tracker.id,
        raw: true,
      });
      expect(ownerSpending.spendingOverTime.periods.reduce((sum, p) => sum + p.expense, 0)).toBe(350);

      const recipientSpending = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTrackerSpendingStats({ id: tracker.id, raw: true }),
      });
      expect(recipientSpending.spendingOverTime.periods.reduce((sum, p) => sum + p.expense, 0)).toBe(100);
    });
  });

  describe('Household auto-grant — explicitly blocked for trackers', () => {
    it('returns 404 on detail and omits the tracker from the list for a household member with no explicit tracker share', async () => {
      const tracker = await helpers.createTracker({
        name: 'Household-no-grant',
        raw: true,
      });

      const ownerApp = await helpers.findAppUserByEmail({
        email: 'test1@test.local',
      });
      const householdMember = await helpers.provisionSecondUserWithBaseCurrency();

      // Grant household membership — this should NOT auto-grant tracker access
      const householdInvitation = await helpers.createHouseholdInvitation({
        ownerUserId: ownerApp.id,
        inviteeEmail: householdMember.email,
        permission: SHARE_PERMISSIONS.write,
      });
      await helpers.asUser({
        cookies: householdMember.cookies,
        fn: () =>
          helpers.acceptShareInvitation({
            token: householdInvitation.token,
            raw: true,
          }),
      });

      const res = await helpers.asUser({
        cookies: householdMember.cookies,
        fn: () => helpers.getTrackerById({ id: tracker.id, raw: false }),
      });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);

      const trackers = await helpers.asUser({
        cookies: householdMember.cookies,
        fn: () => helpers.getTrackers({ raw: true }),
      });

      expect((trackers as Array<{ id: string }>).find((b) => b.id === tracker.id)).toBeUndefined();
    }, 30000);
  });

  describe('GET /categories?includeAccessible=true — tracker-share scope', () => {
    it("exposes only the shared tracker's referenced categories, not the owner's whole tree", async () => {
      const account = await helpers.createAccount({ raw: true });

      const referencedCategory = await helpers.addCustomCategory({
        name: 'tracker-referenced-cat',
        color: '#123456',
        raw: true,
      });
      const unrelatedCategory = await helpers.addCustomCategory({
        name: 'owner-unrelated-cat',
        color: '#654321',
        raw: true,
      });

      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: referencedCategory.id,
        }),
        raw: true,
      });

      const tracker = await helpers.createTracker({
        name: 'Shared category-scope tracker',
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
        permission: SHARE_PERMISSIONS.read,
      });

      const recipientOwnCategory = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.addCustomCategory({
            name: 'recipient-own-cat',
            color: '#00FF00',
            raw: true,
          }),
      });

      const list = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getCategoriesList({ includeAccessible: true }),
      });

      // Referenced by the shared tracker's tx — must resolve so the name renders.
      expect(list.find((c) => c.id === referencedCategory.id)).toBeDefined();
      // Recipient's own categories are always part of the union.
      expect(list.find((c) => c.id === recipientOwnCategory.id)).toBeDefined();
      // Owner category the shared tracker never references must NOT leak.
      expect(list.find((c) => c.id === unrelatedCategory.id)).toBeUndefined();
    });
  });
});

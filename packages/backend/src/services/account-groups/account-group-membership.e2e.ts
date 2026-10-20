import { RESOURCE_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { beforeEach, describe, expect, it } from '@jest/globals';
import AccountGrouping from '@models/accounts-groups/account-grouping.model';
import AccountGroup from '@models/accounts-groups/account-groups.model';
import Accounts from '@models/accounts.model';
import * as helpers from '@tests/helpers';

describe('Account group membership', () => {
  let account: Accounts;
  let group: AccountGroup;

  beforeEach(async () => {
    account = await helpers.createAccount({ raw: true });
    group = await helpers.createAccountGroup({ name: 'test', raw: true });
  });

  describe('Add', () => {
    it('successfully adds account to group_1 -> group_2 -> group_1', async () => {
      const group_2 = await helpers.createAccountGroup({
        name: 'test-1',
        raw: true,
      });
      const firstAdd = await helpers.addAccountToGroup({
        accountId: account.id,
        groupId: group.id,
      });
      expect(firstAdd.statusCode).toBe(200);

      await helpers.addAccountToGroup({
        accountId: account.id,
        groupId: group_2.id,
      });
      const result = await helpers.addAccountToGroup({
        accountId: account.id,
        groupId: group.id,
      });

      expect(result.statusCode).toBe(200);
    });

    it('fails when account does not exist', async () => {
      const result = await helpers.addAccountToGroup({
        accountId: generateRandomRecordId(),
        groupId: group.id,
      });

      expect(result.statusCode).toBe(404);
    });

    it('fails when group does not exist', async () => {
      const result = await helpers.addAccountToGroup({
        accountId: account.id,
        groupId: generateRandomRecordId(),
      });

      expect(result.statusCode).toBe(404);
    });

    it("returns 404 when user B tries to add user A's account to their own group", async () => {
      const userB = await helpers.provisionSecondUserWithBaseCurrency();
      const userBGroup = await helpers.asUser({
        cookies: userB.cookies,
        fn: () => helpers.createAccountGroup({ name: 'userB-group', raw: true }),
      });

      const res = await helpers.asUser({
        cookies: userB.cookies,
        fn: () =>
          helpers.addAccountToGroup({
            accountId: account.id,
            groupId: userBGroup.id,
          }),
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when user B tries to add their own account to user A's group", async () => {
      const userB = await helpers.provisionSecondUserWithBaseCurrency();
      const userBAccount = await helpers.asUser({
        cookies: userB.cookies,
        fn: () => helpers.createAccount({ raw: true }),
      });

      const res = await helpers.asUser({
        cookies: userB.cookies,
        fn: () =>
          helpers.addAccountToGroup({
            accountId: userBAccount.id,
            groupId: group.id,
          }),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('Remove', () => {
    it('removes one, many, and already-removed memberships', async () => {
      const accountB = await helpers.createAccount({ raw: true });
      await helpers.addAccountToGroup({
        accountId: account.id,
        groupId: group.id,
      });
      await helpers.addAccountToGroup({
        accountId: accountB.id,
        groupId: group.id,
      });

      const single = await helpers.removeAccountFromGroup({
        accountIds: [account.id],
        groupId: group.id,
      });
      expect(single.statusCode).toBe(200);

      const afterSingle = await helpers.getAccountsInGroup({
        groupId: group.id,
        raw: true,
      });
      expect(afterSingle.map((row) => row.accountId)).toEqual([accountB.id]);

      const repeat = await helpers.removeAccountFromGroup({
        accountIds: [account.id],
        groupId: group.id,
      });
      expect(repeat.statusCode).toBe(200);

      await helpers.addAccountToGroup({
        accountId: account.id,
        groupId: group.id,
      });
      const both = await helpers.removeAccountFromGroup({
        accountIds: [account.id, accountB.id],
        groupId: group.id,
      });
      expect(both.statusCode).toBe(200);

      const afterBoth = await helpers.getAccountsInGroup({
        groupId: group.id,
        raw: true,
      });
      expect(afterBoth).toHaveLength(0);
    }, 60_000);

    it('fails when trying to remove non-existing account', async () => {
      const result = await helpers.removeAccountFromGroup({
        accountIds: [generateRandomRecordId()],
        groupId: group.id,
      });

      expect(result.statusCode).toBe(404);
    });

    it("returns 404 when user B tries to remove accounts from user A's group", async () => {
      await helpers.addAccountToGroup({
        accountId: account.id,
        groupId: group.id,
      });

      const userB = await helpers.provisionSecondUserWithBaseCurrency();

      const res = await helpers.asUser({
        cookies: userB.cookies,
        fn: () =>
          helpers.removeAccountFromGroup({
            accountIds: [account.id],
            groupId: group.id,
          }),
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when user B tries to remove user A's account from their own group", async () => {
      const userB = await helpers.provisionSecondUserWithBaseCurrency();
      const userBGroup = await helpers.asUser({
        cookies: userB.cookies,
        fn: () => helpers.createAccountGroup({ name: 'userB-group', raw: true }),
      });

      const res = await helpers.asUser({
        cookies: userB.cookies,
        fn: () =>
          helpers.removeAccountFromGroup({
            accountIds: [account.id],
            groupId: userBGroup.id,
          }),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  /**
   * `AccountGroupings` carries one `(accountId, groupId)` row per user, because every
   * `AccountGroup.userId` is per-user. Owner and recipient therefore group the same
   * shared account independently.
   */
  describe('Shared accounts', () => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    async function shareWithRecipient({
      accountId,
      recipient,
    }: {
      accountId: string;
      recipient: helpers.SecondUserHandle;
    }) {
      const invitation = await helpers.createShareInvitation({
        inviteeEmail: recipient.email,
        resourceType: RESOURCE_TYPES.account,
        resourceId: accountId,
        permission: SHARE_PERMISSIONS.read,
        raw: true,
      });
      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
      });
    }

    it("recipient can group a shared account into their own group without touching the owner's grouping", async () => {
      await helpers.addAccountToGroup({
        accountId: account.id,
        groupId: group.id,
      });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareWithRecipient({ accountId: account.id, recipient });

      const recipientGroup = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.createAccountGroup({ name: 'recipient-group', raw: true }),
      });

      const res = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.addAccountToGroup({
            accountId: account.id,
            groupId: recipientGroup.id,
          }),
      });

      expect(res.statusCode).toBe(200);

      const groupings = await AccountGrouping.findAll({
        where: { accountId: account.id },
      });
      expect(groupings).toHaveLength(2);
      const groupIds = groupings.map((g) => g.groupId).toSorted((a, b) => a.localeCompare(b));
      expect(groupIds).toEqual([group.id, recipientGroup.id].toSorted((a, b) => a.localeCompare(b)));
    });

    it("recipient removing their grouping leaves the owner's grouping intact", async () => {
      await helpers.addAccountToGroup({
        accountId: account.id,
        groupId: group.id,
      });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareWithRecipient({ accountId: account.id, recipient });

      const recipientGroup = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.createAccountGroup({ name: 'recipient-group', raw: true }),
      });

      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.addAccountToGroup({
            accountId: account.id,
            groupId: recipientGroup.id,
          }),
      });

      const removeRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.removeAccountFromGroup({
            accountIds: [account.id],
            groupId: recipientGroup.id,
          }),
      });

      expect(removeRes.statusCode).toBe(200);

      const remaining = await AccountGrouping.findAll({
        where: { accountId: account.id },
      });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.groupId).toBe(group.id);
    });

    it("stranger requesting the owner's groupId gets an empty result, never the owner's account ids", async () => {
      await helpers.addAccountToGroup({
        accountId: account.id,
        groupId: group.id,
      });

      const stranger = await helpers.provisionSecondUserWithBaseCurrency();

      const res = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => helpers.getAccountsInGroup({ groupId: group.id }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.response).toEqual([]);
      const accountIds = res.body.response.map((g) => g.accountId);
      expect(accountIds).not.toContain(account.id);
    });

    it('owner can list the accounts in their own group', async () => {
      await helpers.addAccountToGroup({
        accountId: account.id,
        groupId: group.id,
      });

      const res = await helpers.getAccountsInGroup({
        groupId: group.id,
        raw: true,
      });

      expect(res).toHaveLength(1);
      expect(res[0]!.accountId).toBe(account.id);
    });
  });
});

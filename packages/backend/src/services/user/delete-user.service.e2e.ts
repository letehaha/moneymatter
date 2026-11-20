import {
  NOTIFICATION_TYPES,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  SUBSCRIPTION_STATUSES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { API_RESPONSE_STATUS } from '@bt/shared/types/api';
import { authPool } from '@config/auth';
import { afterEach, describe, expect, it } from '@jest/globals';
import Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import { connection } from '@models/index';
import Portfolios from '@models/investments/portfolios.model';
import Notifications from '@models/notifications.model';
import ResourceShares from '@models/resource-shares.model';
import Trackers from '@models/trackers.model';
import Transactions from '@models/transactions.model';
import UserSettings from '@models/user-settings.model';
import UsersCurrencies from '@models/users-currencies.model';
import Users from '@models/users.model';
import * as helpers from '@tests/helpers';
import { HttpResponse, http } from 'msw';

describe('User deletion (DELETE /user/delete)', () => {
  it('should delete user and all related data via CASCADE', async () => {
    const account1 = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Account 1' }),
      raw: true,
    });
    const account2 = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Account 2' }),
      raw: true,
    });

    const category1 = await helpers.addCustomCategory({
      name: 'Category 1',
      color: '#FF0000',
      raw: true,
    });
    const category2 = await helpers.addCustomCategory({
      name: 'Category 2',
      color: '#00FF00',
      raw: true,
    });
    // Nested category covers the self-referencing FK on Categories.parentId.
    const childCategory = await helpers.addCustomCategory({
      name: 'Child Category',
      parentId: category1.id,
      color: '#0000FF',
      raw: true,
    });

    const [expenseTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account1.id,
        amount: 1000,
        transactionType: TRANSACTION_TYPES.expense,
        categoryId: category1.id,
      }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account1.id,
        amount: 200,
        categoryId: category2.id,
      }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account2.id,
        amount: 300,
        categoryId: category1.id,
      }),
      raw: true,
    });

    const [refundTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account1.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });
    await helpers.createSingleRefund({
      originalTxId: expenseTx!.id,
      refundTxId: refundTx!.id,
    });

    const group1 = await helpers.createAccountGroup({ name: 'Group 1', raw: true });
    const group2 = await helpers.createAccountGroup({ name: 'Group 2', raw: true });
    await helpers.addAccountToGroup({ accountId: account1.id, groupId: group1.id, raw: true });
    await helpers.addAccountToGroup({ accountId: account2.id, groupId: group1.id, raw: true });
    await helpers.addAccountToGroup({ accountId: account1.id, groupId: group2.id, raw: true });

    const tracker = await helpers.createTracker({
      name: 'Test Tracker',
      limitAmount: 5000,
      raw: true,
    });
    await helpers.addTransactionsToTracker({
      id: tracker.id,
      payload: { transactionIds: [expenseTx!.id] },
      raw: true,
    });

    const portfolio = await helpers.createPortfolio({
      payload: { name: 'Test Portfolio' },
      raw: true,
    });
    const securities = await helpers.seedSecurities([{ symbol: 'AAPL', name: 'Apple Inc.' }]);
    await helpers.createHolding({
      payload: {
        portfolioId: portfolio.id,
        securityId: securities[0]!.id,
      },
      raw: true,
    });

    await helpers.addUserCurrencies({ currencyCodes: ['USD', 'EUR'], raw: true });
    await helpers.updateUserCurrency({
      currency: {
        currencyCode: 'EUR',
        exchangeRate: 1.1,
        liveRateUpdate: false,
      },
      raw: true,
    });

    await helpers.updateUserSettings({ settings: { locale: 'uk' } });

    // Verify all entities exist before deletion
    const accountsBefore = await helpers.getAccounts();
    const categoriesBefore = await helpers.getCategoriesList();
    const transactionsBefore = await helpers.getTransactions({ raw: true });
    const groupsBefore = await helpers.getAccountGroups({ raw: true });
    const trackersBefore = await helpers.getTrackers({ raw: true });
    const portfoliosBefore = await helpers.listPortfolios({ raw: true });
    const currenciesBefore = await helpers.getUserCurrencies();
    const settingsBefore = await UserSettings.findAll({});

    expect(accountsBefore.length).toBeGreaterThanOrEqual(2);
    expect(categoriesBefore.find((c) => c.id === category1.id)).toBeDefined();
    expect(categoriesBefore.find((c) => c.id === childCategory.id)).toBeDefined();
    expect(transactionsBefore.length).toBeGreaterThanOrEqual(4);
    expect(groupsBefore.length).toBeGreaterThanOrEqual(2);
    expect(trackersBefore.length).toBeGreaterThanOrEqual(1);
    expect(portfoliosBefore.data.length).toBeGreaterThanOrEqual(1);
    expect(currenciesBefore.length).toBeGreaterThanOrEqual(3);
    expect(settingsBefore).toHaveLength(1);

    // Delete user
    const deleteRes = await helpers.deleteUserAccount();
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.body.status).toBe(API_RESPONSE_STATUS.success);

    // Verify all data is deleted by querying database directly
    // (API calls will fail because user is deleted and token is invalid)
    const accountsAfter = await Accounts.findAll({ where: { id: [account1.id, account2.id] } });
    const categoriesAfter = await Categories.findAll({
      where: { id: [category1.id, category2.id, childCategory.id] },
    });
    const transactionsAfter = await Transactions.findAll({ where: { accountId: [account1.id, account2.id] } });
    const trackersAfter = await Trackers.findAll({ where: { id: tracker.id } });
    const portfoliosAfter = await Portfolios.findAll({ where: { id: portfolio.id } });
    const currenciesAfter = await UsersCurrencies.findAll({});
    const settingsAfter = await UserSettings.findAll({ where: {} });

    expect(accountsAfter).toHaveLength(0);
    expect(categoriesAfter).toHaveLength(0);
    expect(transactionsAfter).toHaveLength(0);
    expect(trackersAfter).toHaveLength(0);
    expect(portfoliosAfter).toHaveLength(0);
    expect(currenciesAfter).toHaveLength(0);
    expect(settingsAfter).toHaveLength(0);
  }, 120_000);

  it('should delete user from better-auth tables (ba_*)', async () => {
    // Get authUserId before deletion (the mock always returns 'test-user-id')
    const user = await Users.findOne({ where: {} });
    expect(user).not.toBeNull();
    const authUserId = user!.authUserId;

    // Verify ba_user record exists before deletion
    const [baUserBefore] = await connection.sequelize.query('SELECT id FROM ba_user WHERE id = :authUserId', {
      replacements: { authUserId },
    });
    expect((baUserBefore as { id: string }[]).length).toBe(1);

    // Verify ba_session exists (created during login in beforeEach)
    const [baSessionBefore] = await connection.sequelize.query(
      'SELECT id FROM ba_session WHERE "userId" = :authUserId',
      { replacements: { authUserId } },
    );
    expect((baSessionBefore as { id: string }[]).length).toBeGreaterThanOrEqual(1);

    // Verify ba_account exists
    const [baAccountBefore] = await connection.sequelize.query(
      'SELECT id FROM ba_account WHERE "userId" = :authUserId',
      { replacements: { authUserId } },
    );
    expect((baAccountBefore as { id: string }[]).length).toBeGreaterThanOrEqual(1);

    // Delete user
    const deleteRes = await helpers.deleteUserAccount();
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.body.status).toBe(API_RESPONSE_STATUS.success);

    // Verify ba_user is deleted
    const [baUserAfter] = await connection.sequelize.query('SELECT id FROM ba_user WHERE id = :authUserId', {
      replacements: { authUserId },
    });
    expect((baUserAfter as { id: string }[]).length).toBe(0);

    // Verify ba_session is deleted (CASCADE from ba_user)
    const [baSessionAfter] = await connection.sequelize.query(
      'SELECT id FROM ba_session WHERE "userId" = :authUserId',
      { replacements: { authUserId } },
    );
    expect((baSessionAfter as { id: string }[]).length).toBe(0);

    // Verify ba_account is deleted (CASCADE from ba_user)
    const [baAccountAfter] = await connection.sequelize.query(
      'SELECT id FROM ba_account WHERE "userId" = :authUserId',
      { replacements: { authUserId } },
    );
    expect((baAccountAfter as { id: string }[]).length).toBe(0);

    // Verify ba_passkey is deleted (CASCADE from ba_user)
    const [baPasskeyAfter] = await connection.sequelize.query(
      'SELECT id FROM ba_passkey WHERE "userId" = :authUserId',
      { replacements: { authUserId } },
    );
    expect((baPasskeyAfter as { id: string }[]).length).toBe(0);
  });
});

describe('User deletion: family-sharing cleanup', () => {
  it('drops ResourceShares via FK CASCADE and notifies recipients of the shared accounts before destroy', async () => {
    const account = await helpers.createAccount({ raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.account,
      resourceId: account.id,
      permission: SHARE_PERMISSIONS.read,
      raw: true,
    });
    await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
    });
    const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });

    const sharesBefore = await ResourceShares.findAll({
      where: { resourceType: RESOURCE_TYPES.account, resourceId: String(account.id) },
    });
    expect(sharesBefore).toHaveLength(1);

    const deleteRes = await helpers.deleteUserAccount();
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.body.status).toBe(API_RESPONSE_STATUS.success);

    const sharesAfter = await ResourceShares.findAll({
      where: { resourceType: RESOURCE_TYPES.account, resourceId: String(account.id) },
    });
    expect(sharesAfter).toHaveLength(0);

    const notifs = await Notifications.findAll({
      where: { userId: recipientApp.id, type: NOTIFICATION_TYPES.shareOwnerAccountDeleted },
    });
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.payload).toMatchObject({
      resourceType: RESOURCE_TYPES.account,
      resourceId: String(account.id),
    });
  }, 60_000);

  it('stamps creatorSnapshot on tx the user created on others’ shared accounts', async () => {
    // Capture primary-user identity now — `helpers.deleteUserAccount()` removes the row
    // we'd otherwise read from. Username is the field the snapshot freezes; we assert
    // the snapshot still carries it after the delete. Email lives in `ba_user` (the
    // better-auth table), not on the app `Users` row, which is why we go through the
    // auth pool for it.
    const probeAccount = await helpers.createAccount({ raw: true });
    const primaryUser = await Users.findByPk(probeAccount.userId);
    expect(primaryUser).not.toBeNull();
    const primaryUsername = primaryUser!.username;
    const baUserRow = await authPool.query<{ email: string }>('SELECT email FROM ba_user WHERE id = $1', [
      primaryUser!.authUserId,
    ]);
    const primaryUserEmail = baUserRow.rows[0]?.email;
    expect(primaryUserEmail).toBeTruthy();

    // Owner-side setup: a separate user creates a shared account and invites primary
    // with write/all so primary can later create a transaction on it.
    const owner = await helpers.provisionSecondUserWithBaseCurrency({ email: `s8-owner-${Date.now()}@test.local` });
    const sharedAccountInfo = await helpers.asUser({
      cookies: owner.cookies,
      fn: async () => {
        const acc = await helpers.createAccount({ raw: true });
        const invite = await helpers.createShareInvitation({
          inviteeEmail: primaryUserEmail!,
          resourceType: RESOURCE_TYPES.account,
          resourceId: acc.id,
          permission: SHARE_PERMISSIONS.write,
          policy: { transactionsWriteScope: 'all' },
          raw: true,
        });
        const categories = await helpers.getCategoriesList();
        return { id: acc.id, inviteToken: invite.token, ownerCategoryId: categories[0]!.id };
      },
    });

    // Primary-side: accept invite and create a transaction. Per S4 the categoryId must
    // belong to the OWNER's set when writing on a shared account.
    await helpers.acceptShareInvitation({ token: sharedAccountInfo.inviteToken, raw: true });
    const [createdTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: sharedAccountInfo.id,
        amount: 100,
        categoryId: sharedAccountInfo.ownerCategoryId,
      }),
      raw: true,
    });
    expect(createdTx).toBeDefined();
    const txId = createdTx!.id;

    const deleteRes = await helpers.deleteUserAccount();
    expect(deleteRes.statusCode).toBe(200);

    // The transaction row survives — it lives on the OWNER's account, not the deleted
    // user's — and carries a frozen snapshot of the deleted creator's identity.
    const survivor = await Transactions.findByPk(txId);
    expect(survivor).not.toBeNull();
    expect(survivor!.userId).toBeNull();
    expect(survivor!.creatorSnapshot).not.toBeNull();
    expect(survivor!.creatorSnapshot).toMatchObject({ username: primaryUsername });
  });

  it('notifies household members when the household owner deletes their account', async () => {
    // Seed an accepted household membership: primary user is the owner, second user is
    // a member. Direct seeding sidesteps the invite flow (covered separately) so this
    // test isolates the user-delete cascade path.
    const ownerAccount = await helpers.createAccount({ raw: true });
    const recipient = await helpers.provisionSecondUserWithBaseCurrency();
    const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });

    await ResourceShares.create({
      ownerUserId: ownerAccount.userId,
      sharedWithUserId: recipientApp.id,
      resourceType: RESOURCE_TYPES.household,
      resourceId: String(ownerAccount.userId),
      permission: SHARE_PERMISSIONS.write,
      acceptedAt: new Date(),
    });

    const deleteRes = await helpers.deleteUserAccount();
    expect(deleteRes.statusCode).toBe(200);

    const notifs = await Notifications.findAll({
      where: { userId: recipientApp.id, type: NOTIFICATION_TYPES.householdRevoked },
    });
    expect(notifs).toHaveLength(1);
    // Cascade dropped the household row.
    const sharesAfter = await ResourceShares.findAll({
      where: { resourceType: RESOURCE_TYPES.household, resourceId: String(ownerAccount.userId) },
    });
    expect(sharesAfter).toHaveLength(0);
  });

  it('notifies the household owner when a member deletes their account', async () => {
    // Primary user is the MEMBER here; second user is the household owner. Primary
    // deletes their account → owner receives `householdMemberAccountDeleted`. This
    // is distinct from `householdLeft` (voluntary `POST /household/leave`).
    const owner = await helpers.provisionSecondUserWithBaseCurrency();
    const ownerApp = await helpers.findAppUserByEmail({ email: owner.email });
    const memberAccount = await helpers.createAccount({ raw: true });

    await ResourceShares.create({
      ownerUserId: ownerApp.id,
      sharedWithUserId: memberAccount.userId,
      resourceType: RESOURCE_TYPES.household,
      resourceId: String(ownerApp.id),
      permission: SHARE_PERMISSIONS.write,
      acceptedAt: new Date(),
    });

    const deleteRes = await helpers.deleteUserAccount();
    expect(deleteRes.statusCode).toBe(200);

    const notifs = await Notifications.findAll({
      where: { userId: ownerApp.id, type: NOTIFICATION_TYPES.householdMemberAccountDeleted },
    });
    expect(notifs).toHaveLength(1);
    // Cascade dropped the household row from the member side.
    const sharesAfter = await ResourceShares.findAll({
      where: {
        ownerUserId: ownerApp.id,
        sharedWithUserId: memberAccount.userId,
        resourceType: RESOURCE_TYPES.household,
      },
    });
    expect(sharesAfter).toHaveLength(0);
  });

  it('converts cross-user transfer legs to out_of_wallet when a household member deletes themselves', async () => {
    // Secondary joins primary's household, creates a cross-user transfer using the
    // household write access, then deletes their own account. Without the cleanup,
    // primary's leg would survive the FK cascade with a `transferId` pointing at the
    // cascade-deleted partner — orphan half-transfer the UI can't render.
    const primaryAccount = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: 'Primary A', initialBalance: 10000 }),
      raw: true,
    });
    const primaryUser = await helpers.findAppUserByEmail({ email: 'test1@test.local' });

    const secondary = await helpers.provisionSecondUserWithBaseCurrency();

    // Provision the secondary side: their own account + a category id owned by them
    // (default categoryId=1 belongs to primary user, so the base leg of the cross-user
    // transfer would 404 without this).
    const { secondaryAccount, secondaryCategoryId } = await helpers.asUser({
      cookies: secondary.cookies,
      fn: async () => {
        const acc = await helpers.createAccount({
          payload: helpers.buildAccountPayload({ name: 'Secondary B', initialBalance: 2000 }),
          raw: true,
        });
        const categories = await helpers.getCategoriesList();
        return { secondaryAccount: acc, secondaryCategoryId: categories[0]!.id };
      },
    });

    const householdInvite = await helpers.createHouseholdInvitation({
      ownerUserId: primaryUser.id,
      inviteeEmail: secondary.email,
    });
    await helpers.asUser({
      cookies: secondary.cookies,
      fn: () => helpers.acceptShareInvitation({ token: householdInvite.token, raw: true }),
    });

    const [secondaryLeg, primaryLeg] = await helpers.asUser({
      cookies: secondary.cookies,
      fn: () =>
        helpers.createTransaction({
          payload: {
            ...helpers.buildTransactionPayload({
              accountId: secondaryAccount.id,
              amount: 5000,
              transactionType: TRANSACTION_TYPES.expense,
              categoryId: secondaryCategoryId,
            }),
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
            destinationAmount: 5000,
            destinationAccountId: primaryAccount.id,
          },
          raw: true,
        }),
    });
    expect(secondaryLeg!.transferId).toBeTruthy();
    expect(secondaryLeg!.transferId).toBe(primaryLeg!.transferId);

    // Secondary deletes their own account. Cleanup must run BEFORE the cascade so the
    // partner leg on primary's account converts to out_of_wallet rather than orphans.
    const deleteRes = await helpers.asUser({
      cookies: secondary.cookies,
      fn: () => helpers.deleteUserAccount(),
    });
    expect(deleteRes.statusCode).toBe(200);

    const secondaryLegAfter = await Transactions.findByPk(secondaryLeg!.id);
    expect(secondaryLegAfter).toBeNull();

    const primaryLegAfter = await Transactions.findByPk(primaryLeg!.id);
    expect(primaryLegAfter).not.toBeNull();
    expect(primaryLegAfter!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);
    expect(primaryLegAfter!.transferId).toBeNull();
    // Note suffix preserves a paper trail of where the funds went (counterpart account name).
    expect(primaryLegAfter!.note).toContain('Secondary B');
  });

  describe('billing', () => {
    afterEach(() => {
      delete process.env.STRIPE_SECRET_KEY;
    });

    const stripeRetrieveMock = ({ status }: { status: string }) =>
      http.get('https://api.stripe.com/v1/subscriptions/:id', () =>
        HttpResponse.json({ id: 'sub_01test', object: 'subscription', status }),
      );

    const arrangeActiveSubscription = async () => {
      const { id } = await helpers.getUserInfo({ raw: true });
      await helpers.sendBillingWebhook({
        payload: helpers.buildStripeSubscriptionEvent({ userId: id }),
      });
      process.env.STRIPE_SECRET_KEY = 'sk_test_key';
      return id;
    };

    it('cancels the live Stripe subscription before destroying the account', async () => {
      const userId = await arrangeActiveSubscription();
      let cancelCalls = 0;
      global.mswMockServer.use(
        stripeRetrieveMock({ status: 'active' }),
        http.delete('https://api.stripe.com/v1/subscriptions/:id', () => {
          cancelCalls += 1;
          return HttpResponse.json({ id: 'sub_01test', object: 'subscription', status: 'canceled' });
        }),
      );

      const res = await helpers.deleteUserAccount();
      expect(res.statusCode).toBe(200);
      expect(cancelCalls).toBe(1);
      expect(await Users.findByPk(userId)).toBeNull();
    });

    it('keeps the account and its data when Stripe refuses to cancel', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [transaction] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const userId = await arrangeActiveSubscription();
      global.mswMockServer.use(
        stripeRetrieveMock({ status: 'active' }),
        http.delete('https://api.stripe.com/v1/subscriptions/:id', () =>
          HttpResponse.json({ error: { type: 'api_error' } }, { status: 500 }),
        ),
      );

      const res = await helpers.deleteUserAccount();
      expect(res.statusCode).not.toBe(200);
      expect(await Users.findByPk(userId)).not.toBeNull();
      expect((await helpers.getUserInfo({ raw: true })).id).toBe(userId);
      expect(await Accounts.findByPk(account.id)).not.toBeNull();
      expect(await Transactions.findByPk(transaction!.id)).not.toBeNull();
    });

    it('deletes without calling Stripe when the only subscription is already canceled', async () => {
      const { id: userId } = await helpers.getUserInfo({ raw: true });
      await helpers.sendBillingWebhook({
        payload: helpers.buildStripeSubscriptionEvent({ userId, status: SUBSCRIPTION_STATUSES.canceled }),
      });
      delete process.env.STRIPE_SECRET_KEY;

      let cancelCalls = 0;
      global.mswMockServer.use(
        http.delete('https://api.stripe.com/v1/subscriptions/:id', () => {
          cancelCalls += 1;
          return HttpResponse.json({ id: 'sub_01test', object: 'subscription', status: 'canceled' });
        }),
      );

      const res = await helpers.deleteUserAccount();
      expect(res.statusCode).toBe(200);
      expect(cancelCalls).toBe(0);
      expect(await Users.findByPk(userId)).toBeNull();
    });

    it('cancels a paused subscription as well', async () => {
      const { id: userId } = await helpers.getUserInfo({ raw: true });
      await helpers.sendBillingWebhook({
        payload: helpers.buildStripeSubscriptionEvent({ userId, status: SUBSCRIPTION_STATUSES.paused }),
      });
      process.env.STRIPE_SECRET_KEY = 'sk_test_key';

      let cancelCalls = 0;
      global.mswMockServer.use(
        stripeRetrieveMock({ status: 'paused' }),
        http.delete('https://api.stripe.com/v1/subscriptions/:id', () => {
          cancelCalls += 1;
          return HttpResponse.json({ id: 'sub_01test', object: 'subscription', status: 'canceled' });
        }),
      );

      const res = await helpers.deleteUserAccount();
      expect(res.statusCode).toBe(200);
      expect(cancelCalls).toBe(1);
      expect(await Users.findByPk(userId)).toBeNull();
    });

    it('deletes without cancelling a subscription Stripe has stopped charging', async () => {
      const { id: userId } = await helpers.getUserInfo({ raw: true });
      await helpers.sendBillingWebhook({
        payload: helpers.buildStripeSubscriptionEvent({ userId, status: 'unpaid' }),
      });
      process.env.STRIPE_SECRET_KEY = 'sk_test_key';

      let cancelCalls = 0;
      global.mswMockServer.use(
        stripeRetrieveMock({ status: 'unpaid' }),
        http.delete('https://api.stripe.com/v1/subscriptions/:id', () => {
          cancelCalls += 1;
          return HttpResponse.json({ id: 'sub_01test', object: 'subscription', status: 'canceled' });
        }),
      );

      const res = await helpers.deleteUserAccount();
      expect(res.statusCode).toBe(200);
      expect(cancelCalls).toBe(0);
      expect(await Users.findByPk(userId)).toBeNull();
    });

    it('deletes without cancelling when Stripe already reports the subscription canceled', async () => {
      const userId = await arrangeActiveSubscription();
      let cancelCalls = 0;
      global.mswMockServer.use(
        stripeRetrieveMock({ status: 'canceled' }),
        http.delete('https://api.stripe.com/v1/subscriptions/:id', () => {
          cancelCalls += 1;
          return HttpResponse.json({ id: 'sub_01test', object: 'subscription', status: 'canceled' });
        }),
      );

      const res = await helpers.deleteUserAccount();
      expect(res.statusCode).toBe(200);
      expect(cancelCalls).toBe(0);
      expect(await Users.findByPk(userId)).toBeNull();
    });

    it('deletes without calling Stripe when the live subscription is billed by the App Store', async () => {
      await helpers.arrangeAppleSubscription();
      const { id: userId } = await helpers.getUserInfo({ raw: true });
      process.env.STRIPE_SECRET_KEY = 'sk_test_key';

      let stripeCalls = 0;
      global.mswMockServer.use(
        http.all('https://api.stripe.com/*', () => {
          stripeCalls += 1;
          return HttpResponse.json({});
        }),
      );

      const res = await helpers.deleteUserAccount();
      expect(res.statusCode).toBe(200);
      expect(stripeCalls).toBe(0);
      expect(await Users.findByPk(userId)).toBeNull();
    });

    it('deletes when Stripe no longer knows the subscription', async () => {
      const userId = await arrangeActiveSubscription();
      global.mswMockServer.use(
        http.get('https://api.stripe.com/v1/subscriptions/:id', () =>
          HttpResponse.json(
            {
              error: {
                type: 'invalid_request_error',
                code: 'resource_missing',
                message: 'No such subscription: sub_01test',
              },
            },
            { status: 404 },
          ),
        ),
      );

      const res = await helpers.deleteUserAccount();
      expect(res.statusCode).toBe(200);
      expect(await Users.findByPk(userId)).toBeNull();
    });
  });
});

import {
  API_RESPONSE_STATUS,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTIONS_WRITE_SCOPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { addDays } from 'date-fns';

/**
 * CRIT9 — GET /transactions/:id — 4-branch coverage for getTransactionById service.
 *
 * Branch 1: caller authored tx AND owns parent account → fast-path isOwner:true
 * Branch 2: caller authored tx on a SHARED account (recipient tx on owner's acct) → share-aware lookup
 * Branch 3: caller did NOT author tx but has accepted share with read perm → tx returned
 * Branch 4: stranger with no claim → null (404)
 */

async function provisionRecipient() {
  const handle = await helpers.signUpSecondUser();
  await helpers.asUser({
    cookies: handle.cookies,
    fn: async () => {
      const res = await helpers.setBaseCurrencyForActiveUser({ currencyCode: global.BASE_CURRENCY.code });
      if (res.statusCode !== 200) {
        throw new Error(`Failed to set base currency: ${res.statusCode} ${JSON.stringify(res.body)}`);
      }
    },
  });
  return handle;
}

async function shareAccountWithRecipient({
  accountId,
  recipient,
  permission,
  transactionsWriteScope,
}: {
  accountId: string;
  recipient: helpers.SecondUserHandle;
  permission: (typeof SHARE_PERMISSIONS)[keyof typeof SHARE_PERMISSIONS];
  transactionsWriteScope?: 'own' | 'all';
}) {
  const invitation = await helpers.createShareInvitation({
    inviteeEmail: recipient.email,
    resourceType: RESOURCE_TYPES.account,
    resourceId: accountId,
    permission,
    policy: transactionsWriteScope ? { transactionsWriteScope } : undefined,
    raw: true,
  });
  await helpers.asUser({
    cookies: recipient.cookies,
    fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
  });
}

describe('GET /transactions/:id — getTransactionById 4-branch coverage', () => {
  it('Branch 1: owner retrieves their own tx on their own account (fast-path isOwner)', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [tx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 15,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });

    const result = await helpers.getTransactionById({ id: tx.id, raw: true });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(tx.id);
    expect(result!.amount).toBe(15);
    expect(result!.canEdit).toBe(true);
  });

  it('Branch 2: recipient-authored tx on a write/all shared account is visible and editable', async () => {
    // Owner creates account and category; shares with recipient (write/all)
    const account = await helpers.createAccount({ raw: true });
    const ownerCategory = await helpers.addCustomCategory({ name: 'shared-cat', color: '#FF0000', raw: true });
    const [ownerTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 30 }),
      raw: true,
    });

    const recipient = await provisionRecipient();
    await shareAccountWithRecipient({
      accountId: account.id,
      recipient,
      permission: SHARE_PERMISSIONS.write,
      transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
    });

    // Recipient creates tx on owner's account
    const [recipientTx] = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () =>
        helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 20,
            transactionType: TRANSACTION_TYPES.expense,
            categoryId: ownerCategory.id,
          }),
          raw: true,
        }),
    });

    // Branch 2: authored by caller but account belongs to owner
    const ownView = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTransactionById({ id: recipientTx.id, raw: true }),
    });

    expect(ownView).not.toBeNull();
    expect(ownView!.id).toBe(recipientTx.id);
    expect(ownView!.amount).toBe(20);

    const ownerTxView = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTransactionById({ id: ownerTx.id, raw: true }),
    });
    expect(ownerTxView!.canEdit).toBe(true);
  }, 60_000);

  it('Branch 3: non-author recipient with accepted read share can fetch the tx but not edit it', async () => {
    // Owner creates account + tx
    const account = await helpers.createAccount({ raw: true });
    const [ownerTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 5,
        transactionType: TRANSACTION_TYPES.income,
      }),
      raw: true,
    });

    // Share read-only with recipient
    const recipient = await provisionRecipient();
    await shareAccountWithRecipient({
      accountId: account.id,
      recipient,
      permission: SHARE_PERMISSIONS.read,
    });

    // Recipient did NOT author the tx — branch 3: canUserAccessResource path
    const result = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTransactionById({ id: ownerTx.id, raw: true }),
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(ownerTx.id);
    expect(result!.amount).toBe(5);
    expect(result!.canEdit).toBe(false);
  });

  it('Branch 4: stranger and unknown ids both resolve to null', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [ownerTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 100,
      }),
      raw: true,
    });

    const stranger = await provisionRecipient();

    const strangerRes = await helpers.asUser({
      cookies: stranger.cookies,
      fn: () => helpers.getTransactionById({ id: ownerTx.id, raw: false }),
    });

    // Controller returns { data: null } with 200 when tx not found for caller
    expect(strangerRes.statusCode).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((strangerRes as any).body.response).toBeNull();

    const unknownIdRes = await helpers.getTransactionById({ id: generateRandomRecordId(), raw: false });
    expect(unknownIdRes.statusCode).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((unknownIdRes as any).body.response).toBeNull();
  });

  it('always returns tags: tagged tx lists its tags, untagged tx gets an empty array', async () => {
    const account = await helpers.createAccount({ raw: true });
    const tag = await helpers.createTag({
      payload: helpers.buildTagPayload({ name: 'Groceries' }),
      raw: true,
    });
    const [tagged] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({ accountId: account.id, amount: 20 }),
        tagIds: [tag.id],
      },
      raw: true,
    });
    const [untagged] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 30 }),
      raw: true,
    });

    const taggedRes = await helpers.getTransactionById({ id: tagged.id, raw: true });
    expect(taggedRes!.tags!.map((t) => t.id)).toEqual([tag.id]);

    const untaggedRes = await helpers.getTransactionById({ id: untagged.id, raw: true });
    expect(untaggedRes!.tags).toEqual([]);
  });
});

describe('GET /transactions/:id — canEdit flag', () => {
  // The single-tx endpoint surfaces `canEdit` from the already-resolved access result —
  // no extra DB cost. The FE uses it as the authoritative write-access signal when the
  // parent account isn't in its local store (typically a budget-share-only fetch).
  it("'own'-scope recipient gets canEdit: false on owner's tx, true on their own", async () => {
    const account = await helpers.createAccount({ raw: true });
    const [ownerTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
      raw: true,
    });
    const recipient = await provisionRecipient();
    await shareAccountWithRecipient({
      accountId: account.id,
      recipient,
      permission: SHARE_PERMISSIONS.write,
      transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.own,
    });

    const [recipientTx] = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () =>
        helpers.createTransaction({
          payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 25 }),
          raw: true,
        }),
    });

    const ownerView = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTransactionById({ id: ownerTx.id, raw: true }),
    });
    expect(ownerView!.canEdit).toBe(false);

    const ownView = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTransactionById({ id: recipientTx.id, raw: true }),
    });
    expect(ownView!.canEdit).toBe(true);
  });
});

describe('GET /transactions/:id — budget-share visibility fallback', () => {
  // Detail endpoint must match list visibility: a budget-share recipient sees owner-
  // attached rows in the budget list, so the detail lookup for the same id should also
  // return the row (with `canEdit: false`). Otherwise the FE edit-dialog's lazy probe
  // reads a null detail response as "unknown" and unlocks the form.
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  async function shareBudgetWithRecipient({
    budgetId,
    recipient,
    permission,
  }: {
    budgetId: string;
    recipient: helpers.SecondUserHandle;
    permission: (typeof SHARE_PERMISSIONS)[keyof typeof SHARE_PERMISSIONS];
  }) {
    const invitation = await helpers.createShareInvitation({
      inviteeEmail: recipient.email,
      resourceType: RESOURCE_TYPES.budget,
      resourceId: budgetId,
      permission,
      raw: true,
    });
    await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
    });
  }

  it('budget-share recipient fetches owner-tx in the budget → tx returned with canEdit: false', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [ownerTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 42 }),
      raw: true,
    });
    const budget = await helpers.createCustomBudget({ name: 'budget-visibility', raw: true });
    await helpers.addTransactionToCustomBudget({
      id: budget.id,
      payload: { transactionIds: [ownerTx!.id] },
      raw: true,
    });
    const recipient = await provisionRecipient();
    await shareBudgetWithRecipient({
      budgetId: budget.id,
      recipient,
      permission: SHARE_PERMISSIONS.manage,
    });

    const result = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTransactionById({ id: ownerTx!.id, raw: true }),
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(ownerTx!.id);
    expect(result!.canEdit).toBe(false);
  });

  it('non-recipient still gets null when tx is not in any budget they can see', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [ownerTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 42 }),
      raw: true,
    });
    const budget = await helpers.createCustomBudget({ name: 'private-budget', raw: true });
    await helpers.addTransactionToCustomBudget({
      id: budget.id,
      payload: { transactionIds: [ownerTx!.id] },
      raw: true,
    });
    // Stranger has no budget share + no account share — fallback must stay null.
    const stranger = await provisionRecipient();

    const res = await helpers.asUser({
      cookies: stranger.cookies,
      fn: () => helpers.getTransactionById({ id: ownerTx!.id, raw: false }),
    });

    expect(res.statusCode).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res as any).body.response).toBeNull();
  });

  it('budget-share recipient still 403s on PUT /transactions/:id for the same tx', async () => {
    // Detail endpoint widening must NOT change write semantics — recipient can read,
    // not write. This is the original bug; lock it down.
    const account = await helpers.createAccount({ raw: true });
    const [ownerTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 42 }),
      raw: true,
    });
    const budget = await helpers.createCustomBudget({ name: 'budget-write-block', raw: true });
    await helpers.addTransactionToCustomBudget({
      id: budget.id,
      payload: { transactionIds: [ownerTx!.id] },
      raw: true,
    });
    const recipient = await provisionRecipient();
    await shareBudgetWithRecipient({
      budgetId: budget.id,
      recipient,
      permission: SHARE_PERMISSIONS.manage,
    });

    const res = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.updateTransaction({ id: ownerTx!.id, payload: { amount: 999 } }),
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('GET /transactions/by-ids', () => {
  it('returns exactly the requested transactions with decimal amounts', async () => {
    const account = await helpers.createAccount({ raw: true });

    const [tx1] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
      raw: true,
    });
    const [tx2] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 200 }),
      raw: true,
    });
    const [tx3] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 300 }),
      raw: true,
    });

    const result = await helpers.getTransactionsByIds({
      ids: [tx1.id, tx2.id],
      raw: true,
    });

    expect(result).toHaveLength(2);
    expect(result.map((t) => t.id).toSorted()).toEqual([tx1.id, tx2.id].toSorted());
    expect(result.map((t) => t.id)).not.toContain(tx3.id);

    // Verify amounts are serialized to decimals
    expect(result.find((t) => t.id === tx1.id)!.amount).toBe(100);
    expect(result.find((t) => t.id === tx2.id)!.amount).toBe(200);

    const noMatches = await helpers.getTransactionsByIds({
      ids: [generateRandomRecordId()],
      raw: true,
    });
    expect(noMatches).toEqual([]);
  });

  it('returns 422 for malformed or missing ids', async () => {
    const nonNumeric = await helpers.makeRequest({
      method: 'get',
      url: '/transactions/by-ids',
      payload: { ids: 'abc,def' },
    });

    expect(nonNumeric.statusCode).toBe(422);
    expect(nonNumeric.body.status).toBe(API_RESPONSE_STATUS.error);

    const missing = await helpers.makeRequest({
      method: 'get',
      url: '/transactions/by-ids',
    });

    expect(missing.statusCode).toBe(422);
    expect(missing.body.status).toBe(API_RESPONSE_STATUS.error);
  });
});

describe('GET /transactions/by-ids — access follows the current share, not the row author', () => {
  it('returns the owner-authored transactions of a shared account to the read-only viewer', async () => {
    const account = await helpers.createAccount({ raw: true });
    const [ownerTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 70 }),
      raw: true,
    });
    const privateAccount = await helpers.createAccount({ raw: true });
    const [privateTx] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: privateAccount.id, amount: 80 }),
      raw: true,
    });

    const recipient = await provisionRecipient();
    await shareAccountWithRecipient({ accountId: account.id, recipient, permission: SHARE_PERMISSIONS.read });

    const viewed = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTransactionsByIds({ ids: [ownerTx.id, privateTx.id], raw: true }),
    });

    expect(viewed.map((tx) => tx.id)).toEqual([ownerTx.id]);
    expect(viewed[0]!.amount).toBe(70);
  });

  it("hides the owner's planned transactions from the share recipient but not from the owner", async () => {
    const account = await helpers.createAccount({ raw: true });
    const [plannedTx] = await helpers.createPlannedTransaction({
      payload: { accountId: account.id, amount: 40, time: addDays(new Date(), 5).toISOString() },
      raw: true,
    });

    const recipient = await provisionRecipient();
    await shareAccountWithRecipient({ accountId: account.id, recipient, permission: SHARE_PERMISSIONS.read });

    const viewed = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTransactionsByIds({ ids: [plannedTx.id], raw: true }),
    });
    expect(viewed).toEqual([]);

    const ownerView = await helpers.getTransactionsByIds({ ids: [plannedTx.id], raw: true });
    expect(ownerView.map((tx) => tx.id)).toEqual([plannedTx.id]);
  });

  it('stops returning a transaction the recipient authored once the owner revokes the share', async () => {
    const account = await helpers.createAccount({ raw: true });
    const ownerCategory = await helpers.addCustomCategory({ name: 'by-ids-cat', color: '#00AA00', raw: true });
    const recipient = await provisionRecipient();
    await shareAccountWithRecipient({
      accountId: account.id,
      recipient,
      permission: SHARE_PERMISSIONS.write,
      transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
    });
    const [recipientTx] = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () =>
        helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 25,
            categoryId: ownerCategory.id,
          }),
          raw: true,
        }),
    });

    const whileShared = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTransactionsByIds({ ids: [recipientTx.id], raw: true }),
    });
    expect(whileShared.map((tx) => tx.id)).toEqual([recipientTx.id]);

    const recipientApp = await helpers.findAppUserByEmail({ email: recipient.email });
    await helpers.revokeShareMember({
      resourceType: RESOURCE_TYPES.account,
      resourceId: account.id,
      memberUserId: recipientApp.id,
      raw: true,
    });

    const afterRevoke = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTransactionsByIds({ ids: [recipientTx.id], raw: true }),
    });
    expect(afterRevoke).toEqual([]);

    const ownerView = await helpers.getTransactionsByIds({ ids: [recipientTx.id], raw: true });
    expect(ownerView.map((tx) => tx.id)).toEqual([recipientTx.id]);
  });
});

describe('Retrieve transaction by transfer id', () => {
  it('returns both legs for a real transferId and nothing for a null one', async () => {
    const accountA = await helpers.createAccount({ raw: true });
    const accountB = await helpers.createAccount({ raw: true });

    const [transferBase] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: accountA.id,
          amount: 5000,
        }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 10000,
        destinationAccountId: accountB.id,
      },
      raw: true,
    });
    const [outOfWallet] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: accountA.id,
          amount: 5000,
        }),
        transferNature: TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
      },
      raw: true,
    });

    const legs = await helpers.getTransactionsByTransferId({
      transferId: transferBase.transferId,
      raw: true,
    });
    expect(legs.length).toBe(2);

    const noLegs = await helpers.getTransactionsByTransferId({
      transferId: outOfWallet.transferId,
      raw: true,
    });
    expect(noLegs.length).toBe(0);
  });

  it('returns both legs to a household recipient even when neither leg was authored by them', async () => {
    // Reproduces the "Hidden account" UI bug: inviter creates a transfer between two of
    // their own accounts; the recipient (granted household access) used to see only zero
    // legs because the model query filtered by `Transactions.userId` (the author), which
    // never matches across users. Visibility must follow account access, not authorship.
    const ownerAccountA = await helpers.createAccount({ raw: true });
    const ownerAccountB = await helpers.createAccount({ raw: true });
    const [base] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: ownerAccountA.id,
          amount: 5000,
        }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 5000,
        destinationAccountId: ownerAccountB.id,
      },
      raw: true,
    });

    const recipient = await provisionRecipient();
    const inv = await helpers.createHouseholdInvitation({
      ownerUserId: ownerAccountA.userId,
      inviteeEmail: recipient.email,
    });
    await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.acceptShareInvitation({ token: inv.token, raw: true }),
    });

    const res = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTransactionsByTransferId({ transferId: base.transferId, raw: true }),
    });

    expect(res.length).toBe(2);
    const accountIds = new Set(res.map((tx) => tx.accountId));
    expect(accountIds).toEqual(new Set([ownerAccountA.id, ownerAccountB.id]));
  });

  it('returns only the visible leg to a per-resource recipient when the other leg lives on a private account', async () => {
    // Per-resource sharing narrows visibility to the shared account only — the opposite
    // leg lives on the owner's still-private account, so the recipient must not see it.
    // Keeps the "Hidden account" placeholder honest for genuinely-hidden counterparts.
    const sharedAccount = await helpers.createAccount({ raw: true });
    const privateAccount = await helpers.createAccount({ raw: true });
    const [base] = await helpers.createTransaction({
      payload: {
        ...helpers.buildTransactionPayload({
          accountId: sharedAccount.id,
          amount: 5000,
        }),
        transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
        destinationAmount: 5000,
        destinationAccountId: privateAccount.id,
      },
      raw: true,
    });

    const recipient = await provisionRecipient();
    await shareAccountWithRecipient({
      accountId: sharedAccount.id,
      recipient,
      permission: SHARE_PERMISSIONS.read,
    });

    const res = await helpers.asUser({
      cookies: recipient.cookies,
      fn: () => helpers.getTransactionsByTransferId({ transferId: base.transferId, raw: true }),
    });

    expect(res.length).toBe(1);
    expect(res[0]!.accountId).toBe(sharedAccount.id);
  });
});

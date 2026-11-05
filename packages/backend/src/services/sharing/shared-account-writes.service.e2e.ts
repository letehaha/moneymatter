import {
  CATEGORIZATION_MODE,
  CATEGORIZATION_SOURCE,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
  TRANSACTIONS_WRITE_SCOPES,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';

/**
 * S4 — Write paths on shared accounts. Covers create/update/delete authorization on
 * shared accounts plus the `transactionsWriteScope: 'own' | 'all'` policy enforcement,
 * plus the categories `?accountId=` routing introduced for the picker side of the same
 * slice. See `docs/prds/family-sharing.md` (F3, F4) and `docs/prds/family-sharing-categories.md`.
 */

interface ShareAccountParams {
  accountId: string;
  recipient: helpers.SecondUserHandle;
  permission: (typeof SHARE_PERMISSIONS)[keyof typeof SHARE_PERMISSIONS];
  transactionsWriteScope?: 'own' | 'all';
}

/** Owner-side: create + auto-accept by recipient. Requires owner cookies in `global.APP_AUTH_COOKIES`. */
async function shareAccount({
  accountId,
  recipient,
  permission,
  transactionsWriteScope,
}: ShareAccountParams): Promise<void> {
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

/** Owner creates a category that the recipient should NOT be able to use on their own accounts. */
async function ownerCreatesCategory(name: string) {
  return helpers.addCustomCategory({ name, color: '#FF0000', raw: true });
}

describe('Shared account writes — S4', () => {
  describe('POST /transactions on a shared account', () => {
    it('rejects a recipient supplying their own categoryId on a shared account (must be owner-set)', async () => {
      const account = await helpers.createAccount({ raw: true });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      // Recipient creates a category on *their own* side.
      const recipientCategory = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.addCustomCategory({ name: 'recipient-side', color: '#00FF00', raw: true }),
      });

      const res = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 100,
              categoryId: recipientCategory.id,
            }),
          }),
      });

      // The category lookup is scoped to the account owner → recipient's own categoryId
      // resolves to `not found` → 404.
      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('blocks a recipient from creating a transfer on a shared account (deferred to a later slice)', async () => {
      const account = await helpers.createAccount({ raw: true });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      // Build a destination account on the recipient's side.
      const destinationAccount = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.createAccount({ raw: true }),
      });

      const res = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: {
              ...helpers.buildTransactionPayload({
                accountId: account.id,
                amount: 100,
              }),
              transferNature: 'common_transfer',
              destinationAmount: 100,
              destinationAccountId: destinationAccount.id,
            } as never,
          }),
      });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('PUT /transactions/:id on a shared account', () => {
    it("blocks a write/all recipient from changing the transaction's accountId", async () => {
      const account = await helpers.createAccount({ raw: true });
      const ownerCategory = await ownerCreatesCategory('Groceries (owner)');
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          categoryId: ownerCategory.id,
        }),
        raw: true,
      });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      const recipientAccount = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.createAccount({ raw: true }),
      });

      const res = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.updateTransaction({
            id: ownerTx.id,
            payload: { accountId: recipientAccount.id },
          }),
      });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('recipient permission matrix on a shared account', () => {
    it('lets a write/all recipient create with the owner category, then update and delete the owner tx', async () => {
      const account = await helpers.createAccount({ raw: true });
      const ownerCategory = await ownerCreatesCategory('Groceries (owner)');
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          categoryId: ownerCategory.id,
        }),
        raw: true,
      });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      const createRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 1234,
              transactionType: TRANSACTION_TYPES.expense,
              categoryId: ownerCategory.id,
            }),
          }),
      });
      expect(createRes.statusCode).toBe(200);

      const updateRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.updateTransaction({ id: ownerTx.id, payload: { amount: 200 } }),
      });
      expect(updateRes.statusCode).toBe(200);

      const deleteRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.deleteTransaction({ id: ownerTx.id }),
      });
      expect(deleteRes.statusCode).toBe(200);
    }, 30000);

    it('blocks a write/own recipient on owner-authored rows while allowing their own', async () => {
      const account = await helpers.createAccount({ raw: true });
      const ownerCategory = await ownerCreatesCategory('Groceries (owner)');
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          categoryId: ownerCategory.id,
        }),
        raw: true,
      });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.own,
      });

      const ownerUpdateRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.updateTransaction({
            id: ownerTx.id,
            payload: { amount: 999 },
          }),
      });
      expect(ownerUpdateRes.statusCode).toBe(ERROR_CODES.Unauthorized);

      const ownerDeleteRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.deleteTransaction({ id: ownerTx.id }),
      });
      expect(ownerDeleteRes.statusCode).toBe(ERROR_CODES.Unauthorized);

      const [recipientTx] = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 50,
              categoryId: ownerCategory.id,
            }),
            raw: true,
          }),
      });

      const ownUpdateRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.updateTransaction({
            id: recipientTx.id,
            payload: { amount: 60 },
          }),
      });
      expect(ownUpdateRes.statusCode).toBe(200);

      const ownDeleteRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.deleteTransaction({ id: recipientTx.id }),
      });
      expect(ownDeleteRes.statusCode).toBe(200);
    }, 30000);

    it('returns 404 on create and 403 on update/delete to a non-recipient', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
        raw: true,
      });
      const stranger = await helpers.provisionSecondUserWithBaseCurrency();

      const createRes = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
          }),
      });
      expect(createRes.statusCode).toBe(ERROR_CODES.NotFoundError);

      // Tx exists but the caller has no write claim: surface "forbidden" rather than
      // the misleading "not found". UUID ids make existence-leak via 403 vs 404 moot.
      const updateRes = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => helpers.updateTransaction({ id: ownerTx.id, payload: { amount: 200 } }),
      });
      expect(updateRes.statusCode).toBe(ERROR_CODES.Forbidden);

      const deleteRes = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => helpers.deleteTransaction({ id: ownerTx.id }),
      });
      expect(deleteRes.statusCode).toBe(ERROR_CODES.Forbidden);
    }, 30000);

    it('returns 404 on create and 403 on update/delete to a read-only recipient', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
        raw: true,
      });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({ accountId: account.id, recipient, permission: SHARE_PERMISSIONS.read });

      const createRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
          }),
      });
      expect(createRes.statusCode).toBe(ERROR_CODES.NotFoundError);

      const updateRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.updateTransaction({ id: ownerTx.id, payload: { amount: 200 } }),
      });
      expect(updateRes.statusCode).toBe(ERROR_CODES.Forbidden);

      const deleteRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.deleteTransaction({ id: ownerTx.id }),
      });
      expect(deleteRes.statusCode).toBe(ERROR_CODES.Forbidden);
    }, 30000);
  });

  describe('Phase-1 refund guards on a shared account', () => {
    /**
     * Recipients cannot create, modify, or remove refund relationships on shared accounts:
     * those flows touch transactions across the caller/owner boundary. Owners always pass.
     */
    it('rejects a recipient linking, modifying or deleting refund-linked rows', async () => {
      const account = await helpers.createAccount({ raw: true });
      const ownerCategory = await ownerCreatesCategory('Groceries (owner)');
      const [originalTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: ownerCategory.id,
        }),
        raw: true,
      });
      const [refundCandidate] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 50,
          transactionType: TRANSACTION_TYPES.income,
          categoryId: ownerCategory.id,
        }),
        raw: true,
      });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      const refundsTxIdRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.updateTransaction({
            id: refundCandidate.id,
            payload: { refundsTxId: originalTx.id },
          }),
      });
      expect(refundsTxIdRes.statusCode).toBe(ERROR_CODES.ValidationError);

      const refundsTargetsRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.updateTransaction({
            id: refundCandidate.id,
            payload: { refundsTargets: [{ txId: originalTx.id }] },
          }),
      });
      expect(refundsTargetsRes.statusCode).toBe(ERROR_CODES.ValidationError);
      const errorMessage = ({ response }: { response: unknown }) =>
        helpers.extractResponse(response as helpers.CustomResponse<helpers.ErrorResponse>).message;
      expect(errorMessage({ response: refundsTargetsRes })).toBe(errorMessage({ response: refundsTxIdRes }));

      const refundedByRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.updateTransaction({
            id: originalTx.id,
            payload: { refundedByTxIds: [refundCandidate.id] },
          }),
      });
      expect(refundedByRes.statusCode).toBe(ERROR_CODES.ValidationError);

      await helpers.createSingleRefund({ originalTxId: originalTx.id, refundTxId: refundCandidate.id });

      const deleteRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.deleteTransaction({ id: originalTx.id }),
      });
      expect(deleteRes.statusCode).toBe(ERROR_CODES.ValidationError);
    }, 30000);
  });

  describe('GET /categories?accountId=', () => {
    it("returns the caller's categories with or without an owned accountId, and rejects combining accountId with includeAccessible", async () => {
      const account = await helpers.createAccount({ raw: true });
      const ownCat = await helpers.addCustomCategory({ name: 'mine-1', color: '#000000', raw: true });

      const listWithoutAccount = await helpers.getCategoriesList();
      expect(listWithoutAccount.find((c) => c.id === ownCat.id)).toBeDefined();

      const listForOwnedAccount = await helpers.getCategoriesList({ accountId: account.id });
      expect(listForOwnedAccount.find((c) => c.id === ownCat.id)).toBeDefined();

      const res = await helpers.getCategoriesListResponse({
        accountId: account.id,
        includeAccessible: true,
      });
      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it("returns the *owner's* categories when accountId is shared with the caller", async () => {
      const account = await helpers.createAccount({ raw: true });
      const ownerCategory = await ownerCreatesCategory('owner-only-cat');
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      const list = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getCategoriesList({ accountId: account.id }),
      });
      const found = list.find((c) => c.id === ownerCategory.id);
      expect(found).toBeDefined();
    });

    it('returns 404 when accountId references an account the caller has no claim on', async () => {
      const account = await helpers.createAccount({ raw: true });
      const stranger = await helpers.provisionSecondUserWithBaseCurrency();

      const res = await helpers.asUser({
        cookies: stranger.cookies,
        fn: () => helpers.getCategoriesListResponse({ accountId: account.id }),
      });

      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('CRIT6 — Owner editing recipient-authored tx on shared account', () => {
    it('lets the owner update and then delete a tx authored by the recipient', async () => {
      const account = await helpers.createAccount({ raw: true });
      const ownerCategory = await ownerCreatesCategory('Groceries-crit6');
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
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
              amount: 300,
              categoryId: ownerCategory.id,
            }),
            raw: true,
          }),
      });

      const updateRes = await helpers.updateTransaction({ id: recipientTx.id, payload: { amount: 9.99 } });
      expect(updateRes.statusCode).toBe(200);

      const updated = await helpers.getTransactionById({ id: recipientTx.id, raw: true });
      expect(updated).not.toBeNull();
      expect(updated!.amount).toBe(9.99);

      const deleteRes = await helpers.deleteTransaction({ id: recipientTx.id });
      expect(deleteRes.statusCode).toBe(200);

      const fetched = await helpers.getTransactionById({ id: recipientTx.id, raw: false });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((fetched as any).body.response).toBeNull();
    }, 30000);
  });

  describe('CRIT6 — Splits managed by recipient on owner-authored tx', () => {
    it('recipient with write/all updates owner tx with new splits → 200, splits visible to both', async () => {
      const account = await helpers.createAccount({ raw: true });
      const ownerCategory = await ownerCreatesCategory('Splits-owner-cat');
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1000,
          categoryId: ownerCategory.id,
        }),
        raw: true,
      });

      // Add a second owner category for the split target
      const ownerCategory2 = await ownerCreatesCategory('Splits-owner-cat-2');

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      // Recipient updates owner's tx adding a split
      const res = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.updateTransaction({
            id: ownerTx.id,
            payload: {
              splits: [{ categoryId: ownerCategory2.id, amount: 400 }],
            },
          }),
      });

      expect(res.statusCode).toBe(200);

      // Owner can see the split
      const ownerView = await helpers.getTransactions({
        raw: true,
        includeSplits: true,
      });
      const ownerTxView = ownerView!.find((t) => t.id === ownerTx.id);
      expect(ownerTxView).toBeDefined();
      expect(ownerTxView!.splits).toHaveLength(1);
      expect(ownerTxView!.splits![0]!.categoryId).toBe(ownerCategory2.id);

      // Recipient can also see the split
      const recipientView = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTransactions({ raw: true, includeSplits: true }),
      });
      const recipientTxView = (recipientView as Array<{ id: string; splits?: Array<{ categoryId: string }> }>).find(
        (t) => t.id === ownerTx.id,
      );
      expect(recipientTxView).toBeDefined();
      expect(recipientTxView!.splits).toHaveLength(1);
      expect(recipientTxView!.splits![0]!.categoryId).toBe(ownerCategory2.id);
    });

    it('owner-added splits not lost when recipient edits tx with same split set', async () => {
      const account = await helpers.createAccount({ raw: true });
      const ownerCategory = await ownerCreatesCategory('Preserve-splits-cat');
      const ownerCategory2 = await ownerCreatesCategory('Preserve-splits-cat-2');

      // Owner creates tx with a split already present
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1000,
          categoryId: ownerCategory.id,
          splits: [{ categoryId: ownerCategory2.id, amount: 300 }],
        }),
        raw: true,
      });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      // Recipient edits the tx while keeping the same split
      const res = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.updateTransaction({
            id: ownerTx.id,
            payload: {
              note: 'recipient-edited',
              splits: [{ categoryId: ownerCategory2.id, amount: 300 }],
            },
          }),
      });

      expect(res.statusCode).toBe(200);

      // Split still present after recipient edit
      const view = await helpers.getTransactions({ raw: true, includeSplits: true });
      const txView = view!.find((t) => t.id === ownerTx.id);
      expect(txView).toBeDefined();
      expect(txView!.splits).toHaveLength(1);
      expect(txView!.splits![0]!.categoryId).toBe(ownerCategory2.id);
    });

    it('rejects a recipient supplying their own categoryId in a split row (must be owner-set)', async () => {
      // Regression: the frontend split-dialog used to source split categories from the
      // recipient's own store while the parent tx form already routed to the owner's set.
      // Result: parent uses owner.cat → split sneaks recipient.cat → backend correctly
      // rejects with SPLIT_INVALID_CATEGORY (HTTP 422). Codifies the contract so a future
      // frontend regression that re-introduces the wrong picker is caught here.
      const account = await helpers.createAccount({ raw: true });
      const ownerCategory = await ownerCreatesCategory('Splits-recipient-leak-owner-cat');
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      // Recipient creates a category on *their own* side — invalid as a split target on
      // the shared account.
      const recipientOwnCategory = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.addCustomCategory({ name: 'split-recipient-side', color: '#0000FF', raw: true }),
      });

      const res = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 30,
              transactionType: TRANSACTION_TYPES.expense,
              categoryId: ownerCategory.id,
              splits: [{ categoryId: recipientOwnCategory.id, amount: 10 }],
            }),
          }),
      });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('GET /categories?includeAccessible=true', () => {
    it("returns the union of caller's own categories plus all shared-owner categories", async () => {
      const account = await helpers.createAccount({ raw: true });
      const ownerCategory = await ownerCreatesCategory('owner-union-cat');
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({ accountId: account.id, recipient, permission: SHARE_PERMISSIONS.read });

      // Recipient creates one of their own — must appear in the union too.
      const recipientOwnCategory = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.addCustomCategory({ name: 'recipient-own-cat', color: '#00FF00', raw: true }),
      });

      const list = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getCategoriesList({ includeAccessible: true }),
      });

      expect(list.find((c) => c.id === ownerCategory.id)).toBeDefined();
      expect(list.find((c) => c.id === recipientOwnCategory.id)).toBeDefined();
    });

    it("does not leak categories from owners whose accounts the caller can't read", async () => {
      // Owner has a category on a private (unshared) account; recipient must not see it via
      // the union endpoint.
      const privateCategory = await ownerCreatesCategory('private-owner-cat');
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();

      const list = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getCategoriesList({ includeAccessible: true }),
      });

      expect(list.find((c) => c.id === privateCategory.id)).toBeUndefined();
    });
  });

  describe('Recipient account currency auto-connect', () => {
    it("auto-connects the shared account's currency to the recipient on create", async () => {
      // Owner connects UAH (so the account can be created in UAH) and creates a UAH account.
      await helpers.addUserCurrencies({ currencyCodes: ['UAH'] });
      const account = await helpers.createAccount({
        payload: { ...helpers.buildAccountPayload(), currencyCode: 'UAH' },
        raw: true,
      });
      const ownerCategory = await ownerCreatesCategory('Groceries (owner)');

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      // Recipient has only their base currency at this point.
      const beforeCurrencies = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getUserCurrencies(),
      });
      expect(beforeCurrencies.find((c) => c.currencyCode === 'UAH')).toBeUndefined();

      const res = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 1000,
              transactionType: TRANSACTION_TYPES.expense,
              categoryId: ownerCategory.id,
            }),
          }),
      });

      expect(res.statusCode).toBe(200);

      // UAH was auto-connected under the hood — no user-facing `currencyNotConnected` error.
      const afterCurrencies = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getUserCurrencies(),
      });
      expect(afterCurrencies.find((c) => c.currencyCode === 'UAH')).toBeDefined();
    });

    it("auto-connects the shared account's currency to the recipient on update", async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['UAH'] });
      const account = await helpers.createAccount({
        payload: { ...helpers.buildAccountPayload(), currencyCode: 'UAH' },
        raw: true,
      });
      const ownerCategory = await ownerCreatesCategory('Groceries (owner)');
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 1000,
          transactionType: TRANSACTION_TYPES.expense,
          categoryId: ownerCategory.id,
        }),
        raw: true,
      });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      const beforeCurrencies = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getUserCurrencies(),
      });
      expect(beforeCurrencies.find((c) => c.currencyCode === 'UAH')).toBeUndefined();

      const res = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.updateTransaction({
            id: ownerTx!.id,
            payload: { amount: 2000 },
          }),
      });

      expect(res.statusCode).toBe(200);

      const afterCurrencies = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getUserCurrencies(),
      });
      expect(afterCurrencies.find((c) => c.currencyCode === 'UAH')).toBeDefined();
    });

    it('is a no-op when the shared account currency matches the recipient base currency', async () => {
      // Account in recipient's base currency — no auto-connect needed, and creation succeeds.
      const account = await helpers.createAccount({ raw: true });
      const ownerCategory = await ownerCreatesCategory('Groceries (owner)');
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      const beforeCurrencies = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getUserCurrencies(),
      });
      const beforeCount = beforeCurrencies.length;

      const res = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 100,
              transactionType: TRANSACTION_TYPES.expense,
              categoryId: ownerCategory.id,
            }),
          }),
      });

      expect(res.statusCode).toBe(200);

      const afterCurrencies = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getUserCurrencies(),
      });
      // No additional currency rows added when account currency == recipient base.
      expect(afterCurrencies.length).toBe(beforeCount);
    });
  });

  /**
   * Payee linking mirrors the category-on-shared-account contract: Payees are
   * scoped to the account owner, so on a shared-account write the recipient
   * must pick from the owner's payee list. Their own private payees are
   * irrelevant to rows that live on the owner's account.
   *
   * Categorization (`payee_rule`) is also owner-scoped: it only fires when the
   * caller IS the account owner. A recipient-authored row gets the owner's
   * payeeId stamped but leaves `categorizationMeta` untouched — the owner can
   * apply their rules later via the post-sync note fuzzy backfill or a manual
   * re-categorize. Owner's rules, owner's account.
   */
  describe('Payee linking on shared accounts', () => {
    it("accepts the owner's payee and rejects the recipient's own on both create and update", async () => {
      const account = await helpers.createAccount({ raw: true });
      const ownerCategory = await ownerCreatesCategory('Payee-owner-cat');
      const ownerPayee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({ name: `Owner Payee ${Date.now()}` }),
        raw: true,
      });
      const [ownerTx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: account.id,
          amount: 100,
          categoryId: ownerCategory.id,
        }),
        raw: true,
      });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      const recipientPayee = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createPayee({
            payload: helpers.buildPayeePayload({ name: `Recipient-side Payee ${Date.now()}` }),
            raw: true,
          }),
      });

      const [createdWithOwnerPayee] = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: {
              ...helpers.buildTransactionPayload({
                accountId: account.id,
                amount: 100,
                categoryId: ownerCategory.id,
              }),
              payeeId: ownerPayee.id,
            },
            raw: true,
          }),
      });
      expect(createdWithOwnerPayee.payeeId).toBe(ownerPayee.id);

      const createWithOwnPayeeRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: {
              ...helpers.buildTransactionPayload({
                accountId: account.id,
                amount: 100,
                categoryId: ownerCategory.id,
              }),
              payeeId: recipientPayee.id,
            },
          }),
      });
      expect(createWithOwnPayeeRes.statusCode).toBe(ERROR_CODES.NotFoundError);

      const attachOwnerPayeeRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.updateTransaction({
            id: ownerTx.id,
            payload: { payeeId: ownerPayee.id },
          }),
      });
      expect(attachOwnerPayeeRes.statusCode).toBe(200);

      const fetched = await helpers.getTransactionById({ id: ownerTx.id, raw: true });
      expect(fetched!.payeeId).toBe(ownerPayee.id);

      const attachOwnPayeeRes = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.updateTransaction({
            id: ownerTx.id,
            payload: { payeeId: recipientPayee.id },
          }),
      });
      expect(attachOwnPayeeRes.statusCode).toBe(ERROR_CODES.NotFoundError);
    }, 30000);

    it("note-extraction respects the owner's payeeExtractionUsesDescription setting", async () => {
      // Owner enables description-based extraction and seeds an exact-match
      // payee. A recipient-side create with a matching note must hit the
      // owner's namespace — even though the recipient's own setting is off by
      // default, the owner's policy is what governs writes on their account.
      const ownerCategory = await ownerCreatesCategory('Note-extract-owner-cat');
      await helpers.updateUserSettings({
        settings: { locale: 'en', payeeExtractionUsesDescription: true },
      });
      const ownerPayee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({
          name: `OwnerMerchantNote-${Date.now()}`,
          defaultCategoryId: ownerCategory.id,
        }),
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      const [tx] = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: helpers.buildTransactionPayload({
              accountId: account.id,
              amount: 100,
              categoryId: ownerCategory.id,
              note: ownerPayee.name,
            }),
            raw: true,
          }),
      });

      expect(tx.payeeId).toBe(ownerPayee.id);
    });

    it('owner-authored write with an enforce-mode payee stamps categorizationMeta', async () => {
      // Baseline check: nothing here changed for owner-on-own-account writes.
      // Confirms the recipient-skip case below is a deliberate divergence, not
      // a regression in the enforce-mode path.
      const enforceCategory = await ownerCreatesCategory(`Enforce-target-${Date.now()}`);
      const otherCategory = await ownerCreatesCategory(`Other-${Date.now()}`);
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({
          name: `Enforce Payee ${Date.now()}`,
          defaultCategoryId: enforceCategory.id,
          categorizationMode: CATEGORIZATION_MODE.enforce,
        }),
        raw: true,
      });
      const account = await helpers.createAccount({ raw: true });

      const [tx] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({
            accountId: account.id,
            amount: 100,
            categoryId: otherCategory.id,
          }),
          payeeId: payee.id,
        },
        raw: true,
      });

      expect(tx.payeeId).toBe(payee.id);
      expect(tx.categoryId).toBe(enforceCategory.id);
      expect(tx.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.payeeRule);
    });

    /**
     * Picker-side coverage: the transaction form's payee dropdown must
     * resolve to the same namespace that the write paths validate against.
     * Mirrors `GET /categories?accountId=` for the categories picker.
     */
    describe('GET /payees?accountId=', () => {
      it("returns the caller's payees with or without an owned accountId (back-compat)", async () => {
        const account = await helpers.createAccount({ raw: true });
        const ownPayee = await helpers.createPayee({
          payload: helpers.buildPayeePayload({ name: `Own Payee List ${Date.now()}` }),
          raw: true,
        });

        const listWithoutAccount = await helpers.listPayees({ raw: true });
        expect(listWithoutAccount.find((p) => p.id === ownPayee.id)).toBeDefined();

        const listForOwnedAccount = await helpers.listPayees({ accountId: account.id, raw: true });
        expect(listForOwnedAccount.find((p) => p.id === ownPayee.id)).toBeDefined();
      });

      it("returns the *owner's* payees when accountId is shared with the caller", async () => {
        const account = await helpers.createAccount({ raw: true });
        const ownerPayee = await helpers.createPayee({
          payload: helpers.buildPayeePayload({ name: `Owner Picker Payee ${Date.now()}` }),
          raw: true,
        });
        const recipient = await helpers.provisionSecondUserWithBaseCurrency();
        await shareAccount({
          accountId: account.id,
          recipient,
          permission: SHARE_PERMISSIONS.write,
          transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
        });

        const recipientPayee = await helpers.asUser({
          cookies: recipient.cookies,
          fn: () =>
            helpers.createPayee({
              payload: helpers.buildPayeePayload({ name: `Recipient Side Payee ${Date.now()}` }),
              raw: true,
            }),
        });

        const list = await helpers.asUser({
          cookies: recipient.cookies,
          fn: () => helpers.listPayees({ accountId: account.id, raw: true }),
        });

        expect(list.find((p) => p.id === ownerPayee.id)).toBeDefined();
        // Recipient's own payees are not in the owner's namespace and must
        // not bleed into the owner-scoped picker — otherwise the user could
        // pick one and trip the write-path 404.
        expect(list.find((p) => p.id === recipientPayee.id)).toBeUndefined();
      });

      it('returns 404 when accountId references an account the caller has no claim on', async () => {
        const account = await helpers.createAccount({ raw: true });
        const stranger = await helpers.provisionSecondUserWithBaseCurrency();

        const res = await helpers.asUser({
          cookies: stranger.cookies,
          fn: () => helpers.listPayees({ accountId: account.id, raw: false }),
        });

        expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
      });
    });

    it("recipient-authored write skips payee_rule even when owner's payee is enforce-mode", async () => {
      // The row gets the owner's payeeId, but `categorizationMeta` stays null
      // because the caller doesn't own the account. The owner can apply their
      // own rules later via the post-sync backfill or a manual re-categorize.
      const enforceCategory = await ownerCreatesCategory(`Enforce-target-rec-${Date.now()}`);
      const otherCategory = await ownerCreatesCategory(`Other-rec-${Date.now()}`);
      const payee = await helpers.createPayee({
        payload: helpers.buildPayeePayload({
          name: `Enforce Payee Rec ${Date.now()}`,
          defaultCategoryId: enforceCategory.id,
          categorizationMode: CATEGORIZATION_MODE.enforce,
        }),
        raw: true,
      });
      const account = await helpers.createAccount({ raw: true });
      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      await shareAccount({
        accountId: account.id,
        recipient,
        permission: SHARE_PERMISSIONS.write,
        transactionsWriteScope: TRANSACTIONS_WRITE_SCOPES.all,
      });

      const [tx] = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () =>
          helpers.createTransaction({
            payload: {
              ...helpers.buildTransactionPayload({
                accountId: account.id,
                amount: 100,
                categoryId: otherCategory.id,
              }),
              payeeId: payee.id,
            },
            raw: true,
          }),
      });

      expect(tx.payeeId).toBe(payee.id);
      // categoryId stays as supplied — payee_rule did NOT overwrite it.
      expect(tx.categoryId).toBe(otherCategory.id);
      expect(tx.categorizationMeta).toBeNull();
    });
  });
});

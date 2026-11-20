import {
  API_ERROR_CODES,
  SUBSCRIPTION_FREQUENCIES,
  TRANSACTION_TRANSFER_NATURE,
  type RecordId,
} from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

const setupAccountWithTransfer = async () => {
  const account = await helpers.createAccount({ raw: true });
  const portfolio = await helpers.createPortfolio({ raw: true });

  await helpers.accountToPortfolioTransfer({
    portfolioId: portfolio.id,
    payload: {
      accountId: account.id,
      amount: '100',
      date: '2024-01-15',
    },
    raw: true,
  });

  return { account, portfolio };
};

describe('Delete Account', () => {
  describe('Account deletion with account groups', () => {
    it('successfully deletes account from multiple groups', async () => {
      const testAccount = await helpers.createAccount({ raw: true });
      const testGroup1 = await helpers.createAccountGroup({ name: 'test-group-1-fresh', raw: true });
      const testGroup2 = await helpers.createAccountGroup({ name: 'test-group-2-fresh', raw: true });

      // Add account to both groups
      const addResult1 = await helpers.addAccountToGroup({
        accountId: testAccount.id,
        groupId: testGroup1.id,
      });
      expect(addResult1.statusCode).toBe(200);

      const addResult2 = await helpers.addAccountToGroup({
        accountId: testAccount.id,
        groupId: testGroup2.id,
      });
      expect(addResult2.statusCode).toBe(200);

      // Delete the account - should succeed due to CASCADE deletion on AccountGroupings
      await helpers.deleteAccount({ id: testAccount.id, raw: true });

      // Verify account is deleted
      const accountsAfterDelete = await helpers.getAccounts();
      const deletedAccount = accountsAfterDelete.find((acc) => acc.id === testAccount.id);
      expect(deletedAccount).toBeUndefined();

      // Verify both groups still exist (they should not be deleted)
      const groupsAfter = await helpers.getAccountGroups({ raw: true });
      const accountGroup1After = groupsAfter.find((g) => g.id === testGroup1.id);
      const accountGroup2After = groupsAfter.find((g) => g.id === testGroup2.id);
      expect(accountGroup1After).toBeDefined();
      expect(accountGroup2After).toBeDefined();
    });
  });

  describe('Account deletion with both groups and transactions', () => {
    let account;
    let group;

    beforeEach(async () => {
      account = await helpers.createAccount({ raw: true });
      group = await helpers.createAccountGroup({ name: 'test-group', raw: true });
    });

    it('successfully deletes account with both transactions and group membership', async () => {
      // Add account to group
      await helpers.addAccountToGroup({
        accountId: account.id,
        groupId: group.id,
      });

      // Create transactions
      await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 100 }),
        raw: true,
      });

      // Verify setup
      const transactionsBefore = await helpers.getTransactions({ raw: true });
      const accountTransactions = transactionsBefore.filter((tx) => tx.accountId === account.id);
      expect(accountTransactions).toHaveLength(1);

      const groupsBefore = await helpers.getAccountGroups({ raw: true });
      const accountGroup = groupsBefore.find((g) => g.id === group.id);
      expect(accountGroup).toBeDefined();
      expect(accountGroup!.accounts).toContainEqual(expect.objectContaining({ id: account.id }));

      // Delete the account
      await helpers.deleteAccount({ id: account.id, raw: true });

      // Verify account is deleted
      const accountsAfterDelete = await helpers.getAccounts();
      const deletedAccount = accountsAfterDelete.find((acc) => acc.id === account.id);
      expect(deletedAccount).toBeUndefined();

      // Verify transactions are deleted
      const transactionsAfterDelete = await helpers.getTransactions({ raw: true });
      const remainingAccountTransactions = transactionsAfterDelete.filter((tx) => tx.accountId === account.id);
      expect(remainingAccountTransactions).toHaveLength(0);

      // Verify group still exists but account is removed
      const groupsAfter = await helpers.getAccountGroups({ raw: true });
      const accountGroupAfter = groupsAfter.find((g) => g.id === group.id);
      expect(accountGroupAfter).toBeDefined();
      expect(accountGroupAfter!.accounts).not.toContainEqual(expect.objectContaining({ id: account.id }));
    });
  });

  describe('Account deletion with loan payments', () => {
    it('rejects deleting a source account that has paid into a loan', async () => {
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          initialBalance: 1_000,
          originalPrincipal: 1_000,
        }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: sourceAccount.id, amount: 300 }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 300,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });

      const response = await helpers.deleteAccount({ id: sourceAccount.id, raw: false });
      expect(response.statusCode).toBe(422);
      const errorBody = (response as helpers.CustomResponse<unknown>).body.response as {
        code: string;
        message: string;
      };
      expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
      expect(errorBody.message).toMatch(/loan/i);

      const accountsAfter = await helpers.getAccounts();
      expect(accountsAfter.some((acc) => acc.id === sourceAccount.id)).toBe(true);
    });

    it('rejects with a Trash-specific message when the only loan payments are trashed', async () => {
      const loan = await helpers.createLoan({
        payload: helpers.buildCreateLoanPayload({
          initialBalance: 1_000,
          originalPrincipal: 1_000,
        }),
        raw: true,
      });
      const sourceAccount = await helpers.createAccount({ raw: true });

      const [payment] = await helpers.createTransaction({
        payload: {
          ...helpers.buildTransactionPayload({ accountId: sourceAccount.id, amount: 300 }),
          transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
          destinationAmount: 300,
          destinationAccountId: loan.id as RecordId,
        },
        raw: true,
      });
      expect((await helpers.deleteTransaction({ id: payment!.id })).statusCode).toBe(200);

      const response = await helpers.deleteAccount({ id: sourceAccount.id, raw: false });
      expect(response.statusCode).toBe(422);
      const errorBody = (response as helpers.CustomResponse<unknown>).body.response as {
        code: string;
        message: string;
      };
      expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
      expect(errorBody.message).toMatch(/permanently from trash/i);

      const accountsAfter = await helpers.getAccounts();
      expect(accountsAfter.some((acc) => acc.id === sourceAccount.id)).toBe(true);
    });
  });

  describe('Account deletion with subscriptions', () => {
    it('deletes an account whose subscription has auto-record enabled', async () => {
      const account = await helpers.createAccount({ raw: true });

      const subscription = await helpers.createSubscription({
        name: 'Auto-record Subscription',
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: new Date().toISOString(),
        accountId: account.id,
        expectedAmount: 10,
        expectedCurrencyCode: account.currencyCode,
        autoRecord: true,
        raw: true,
      });

      const response = await helpers.deleteAccount({ id: account.id, raw: false });
      expect(response.statusCode).toBe(200);

      const accountsAfter = await helpers.getAccounts();
      expect(accountsAfter.some((acc) => acc.id === account.id)).toBe(false);

      const updatedSubscription = await helpers.getSubscriptionById({
        id: String(subscription.id),
        raw: true,
      });
      expect(updatedSubscription.accountId ?? null).toBeNull();
    });
  });

  describe('Account deletion with portfolio transfers', () => {
    it('keeps portfolio transfers as orphans by default', async () => {
      const { account, portfolio } = await setupAccountWithTransfer();

      await helpers.deleteAccount({ id: account.id, raw: true });

      const { data: transfers } = await helpers.listPortfolioTransfers({ portfolioId: portfolio.id, raw: true });
      expect(transfers).toHaveLength(1);
      expect(transfers[0]!.fromAccountId).toBeNull();
      expect(transfers[0]!.transactionId).toBeNull();
    });

    it('deletes portfolio transfers when removePortfolioTransfers is passed', async () => {
      const { account, portfolio } = await setupAccountWithTransfer();

      await helpers.deleteAccount({ id: account.id, removePortfolioTransfers: true, raw: true });

      const { data: transfers } = await helpers.listPortfolioTransfers({ portfolioId: portfolio.id, raw: true });
      expect(transfers).toHaveLength(0);
    });

    it('does not touch transfers of other accounts', async () => {
      const { account, portfolio } = await setupAccountWithTransfer();

      const otherAccount = await helpers.createAccount({ raw: true });
      await helpers.accountToPortfolioTransfer({
        portfolioId: portfolio.id,
        payload: {
          accountId: otherAccount.id,
          amount: '50',
          date: '2024-02-15',
        },
        raw: true,
      });

      await helpers.deleteAccount({ id: account.id, removePortfolioTransfers: true, raw: true });

      const { data: transfers } = await helpers.listPortfolioTransfers({ portfolioId: portfolio.id, raw: true });
      expect(transfers).toHaveLength(1);
      expect(transfers[0]!.fromAccountId).toBe(otherAccount.id);
    });
  });
});

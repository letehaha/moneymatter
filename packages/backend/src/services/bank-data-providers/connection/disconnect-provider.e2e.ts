import {
  API_ERROR_CODES,
  API_RESPONSE_STATUS,
  BANK_PROVIDER_TYPE,
  type RecordId,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  asDecimal,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import {
  VALID_LUNCHFLOW_API_KEY,
  getLunchFlowBalanceMock,
  getLunchFlowTransactionsMock,
} from '@tests/mocks/lunchflow/mock-api';
import { VALID_MONOBANK_TOKEN } from '@tests/mocks/monobank/mock-api';

// Bank-linked accounts reject manual rows, so every precondition is built on a manual
// USD account (the currency of LunchFlow account 1001) before it gets linked.
const setupLinkedLoanSource = async () => {
  const { account: sourceAccount } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });
  const loan = await helpers.createLoan({
    payload: helpers.buildCreateLoanPayload({ initialBalance: 1_000, originalPrincipal: 1_000 }),
    raw: true,
  });

  const [payment] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({ accountId: sourceAccount.id, amount: 300 }),
      transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_loan,
      destinationAmount: 300,
      destinationAccountId: loan.id as RecordId,
    },
    raw: true,
  });

  return { sourceAccount, loan, payment: payment! };
};

const setupCrossUserTransfer = async () => {
  const { account: sourceAccount } = await helpers.createAccountWithNewCurrency({ currency: 'USD' });

  const recipient = await helpers.provisionSecondUserWithBaseCurrency();
  const recipientUser = await helpers.findAppUserByEmail({ email: recipient.email });

  const destAccount = await helpers.asUser({
    cookies: recipient.cookies,
    fn: async () => (await helpers.createAccountWithNewCurrency({ currency: 'USD' })).account,
  });

  const invitation = await helpers.asUser({
    cookies: recipient.cookies,
    fn: () => helpers.createHouseholdInvitation({ ownerUserId: recipientUser.id, inviteeEmail: 'test1@test.local' }),
  });
  await helpers.acceptShareInvitation({ token: invitation.token, raw: true });

  const [sourceLeg, partnerLeg] = await helpers.createTransaction({
    payload: {
      ...helpers.buildTransactionPayload({
        accountId: sourceAccount.id,
        amount: 50,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
      destinationAmount: 50,
      destinationAccountId: destAccount.id,
    },
    raw: true,
  });
  expect(partnerLeg!.accountId).toBe(destAccount.id);
  expect(partnerLeg!.transferId).toBe(sourceLeg!.transferId);

  return { sourceAccount, destAccount, recipient, partnerLeg: partnerLeg! };
};

const expectDisconnectBlocked = async ({
  connectionId,
  accountId,
  loanId,
  messagePattern,
}: {
  connectionId: string;
  accountId: string;
  loanId: string;
  messagePattern: RegExp;
}) => {
  const loanBefore = await helpers.getLoanById({ id: loanId, raw: true });

  const response = await helpers.bankDataProviders.disconnectProvider({
    connectionId,
    removeAssociatedAccounts: true,
  });

  expect(response.statusCode).toBe(422);
  const errorBody = response.body.response as unknown as { code: string; message: string };
  expect(errorBody.code).toBe(API_ERROR_CODES.validationError);
  expect(errorBody.message).toMatch(messagePattern);

  const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
  expect(connections.some((c) => c.id === connectionId)).toBe(true);

  const accountsAfter = await helpers.getAccounts();
  expect(accountsAfter.some((acc) => acc.id === accountId)).toBe(true);

  const loanAfter = await helpers.getLoanById({ id: loanId, raw: true });
  expect(loanAfter.currentBalance).toBe(loanBefore.currentBalance);
};

/**
 * E2E tests for DELETE /bank-data-providers/connections/:connectionId.
 *
 * Covers the lookup behavior for the shared `disconnectProvider` service
 * (used across all providers). Provider-specific disconnect behavior is
 * covered in each provider's flow e2e.
 */
describe('Disconnect provider', () => {
  it('returns 404 when the connection does not exist', async () => {
    // Regression: the service used to silently `return;` for missing
    // connections, letting the controller report "Connection removed
    // successfully" regardless. It now throws NotFoundError.
    const response = await helpers.bankDataProviders.disconnectProvider({
      connectionId: generateRandomRecordId(),
    });

    expect(response.statusCode).toBe(404);
    expect(response.body.status).toBe(API_RESPONSE_STATUS.error);
    expect((response.body.response as unknown as { code: string }).code).toBe(API_ERROR_CODES.notFound);
  });

  it('returns 200 and removes the connection for a valid, owned connectionId', async () => {
    const { connectionId } = await helpers.bankDataProviders.connectProvider({
      providerType: BANK_PROVIDER_TYPE.MONOBANK,
      credentials: { apiToken: VALID_MONOBANK_TOKEN },
      raw: true,
    });

    const response = await helpers.bankDataProviders.disconnectProvider({ connectionId });

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe(API_RESPONSE_STATUS.success);

    const { connections } = await helpers.bankDataProviders.listUserConnections({ raw: true });
    expect(connections.find((c) => c.id === connectionId)).toBeUndefined();
  });

  it('returns 404 on a second disconnect of the same connection', async () => {
    // Regression: pre-fix, a double-disconnect returned 200 for both calls.
    const { connectionId } = await helpers.bankDataProviders.connectProvider({
      providerType: BANK_PROVIDER_TYPE.MONOBANK,
      credentials: { apiToken: VALID_MONOBANK_TOKEN },
      raw: true,
    });

    const first = await helpers.bankDataProviders.disconnectProvider({ connectionId });
    expect(first.statusCode).toBe(200);

    const second = await helpers.bankDataProviders.disconnectProvider({ connectionId });
    expect(second.statusCode).toBe(404);
    expect((second.body.response as unknown as { code: string }).code).toBe(API_ERROR_CODES.notFound);
  });

  it('deletes portfolio transfers funded by accounts removed with removeAssociatedAccounts', async () => {
    // Fixed past month so the single bucket always holds the transfer, whenever the suite runs.
    const range = { from: '2026-01-01', to: '2026-01-31', granularity: 'monthly' as const };
    const bankTransactionId = 'lunchflow-brokerage-deposit';

    // A bank-linked account accepts no new rows, so the funding expense has to arrive through sync.
    global.mswMockServer.use(
      getLunchFlowTransactionsMock({
        response: {
          transactions: [
            {
              id: bankTransactionId,
              accountId: 1001,
              amount: asDecimal(-500),
              currency: 'USD',
              date: '2026-01-10T12:00:00.000Z',
              merchant: 'Brokerage',
              description: 'Brokerage deposit',
              isPending: false,
            },
          ],
          total: 1,
        },
      }),
    );

    const { connectionId } = await helpers.bankDataProviders.connectProvider({
      providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
      credentials: { apiKey: VALID_LUNCHFLOW_API_KEY },
      raw: true,
    });

    const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
      connectionId,
      raw: true,
    });

    const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
      connectionId,
      accountExternalIds: [externalAccounts[0]!.externalId],
      raw: true,
    });

    const portfolio = await helpers.createPortfolio({ raw: true });

    const accountTransactions = await helpers.getTransactions({ accountIds: [syncedAccounts[0]!.id], raw: true });
    const fundingTransaction = accountTransactions.find((tx) => tx.originalId === bankTransactionId)!;

    await helpers.linkTransactionToPortfolio({
      transactionId: fundingTransaction.id,
      payload: { portfolioId: portfolio.id },
      raw: true,
    });

    const before = await helpers.getInvestmentContributions({ ...range, raw: true });
    expect(before.buckets[0]!.total).toBeGreaterThan(0);
    expect(before.buckets[0]!.byPortfolio).toEqual([{ portfolioId: portfolio.id, amount: before.buckets[0]!.total }]);
    expect(before.portfolios).toEqual([{ portfolioId: portfolio.id, name: portfolio.name }]);

    await helpers.bankDataProviders.disconnectProvider({
      connectionId,
      removeAssociatedAccounts: true,
      raw: true,
    });

    // The PortfolioTransfers -> Accounts FK is ON DELETE SET NULL, so destroying the linked
    // accounts leaves the funding transfers behind, still counted as contributions, unless
    // the disconnect deletes them too.
    const { data: transfers } = await helpers.listPortfolioTransfers({ portfolioId: portfolio.id, raw: true });
    expect(transfers).toHaveLength(0);

    const after = await helpers.getInvestmentContributions({ ...range, raw: true });
    expect(after.buckets[0]!.total).toBe(0);
    expect(after.buckets[0]!.byPortfolio).toEqual([]);
    expect(after.portfolios).toEqual([]);
  }, 60_000);

  describe('removeAssociatedAccounts: true', () => {
    it('rejects when a linked account has paid into a loan', async () => {
      const { sourceAccount, loan } = await setupLinkedLoanSource();
      const { connectionId } = await helpers.lunchflow.linkManualAccount({ accountId: sourceAccount.id });

      await expectDisconnectBlocked({
        connectionId,
        accountId: sourceAccount.id,
        loanId: loan.id,
        messagePattern: /delete or reassign them/i,
      });
    }, 60_000);

    it('rejects with a Trash-specific message when the linked account only has trashed loan payments', async () => {
      const { sourceAccount, loan, payment } = await setupLinkedLoanSource();
      expect((await helpers.deleteTransaction({ id: payment.id })).statusCode).toBe(200);
      const { connectionId } = await helpers.lunchflow.linkManualAccount({ accountId: sourceAccount.id });

      await expectDisconnectBlocked({
        connectionId,
        accountId: sourceAccount.id,
        loanId: loan.id,
        messagePattern: /permanently from trash/i,
      });
    }, 60_000);

    it("converts the partner leg on another user's account to out_of_wallet", async () => {
      const { sourceAccount, destAccount, recipient, partnerLeg } = await setupCrossUserTransfer();

      const { connectionId } = await helpers.lunchflow.linkManualAccount({ accountId: sourceAccount.id });

      const response = await helpers.bankDataProviders.disconnectProvider({
        connectionId,
        removeAssociatedAccounts: true,
      });
      expect(response.statusCode).toBe(200);

      const partnerAfter = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTransactionById({ id: partnerLeg.id, raw: true }),
      });
      expect(partnerAfter).not.toBeNull();
      expect(partnerAfter!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);
      expect(partnerAfter!.transferId).toBeNull();

      const destAccountResponse = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getAccount({ id: destAccount.id, raw: false }),
      });
      expect(destAccountResponse.statusCode).toBe(200);
    }, 60_000);

    it('rolls back deletions of earlier accounts when a later linked account is blocked', async () => {
      const { sourceAccount: transferAccount, recipient, partnerLeg } = await setupCrossUserTransfer();
      const { sourceAccount: loanAccount, loan } = await setupLinkedLoanSource();

      // Mock account 1002 reports EUR; the loan source is USD.
      global.mswMockServer.use(
        getLunchFlowBalanceMock({
          accountId: 1002,
          response: { balance: { amount: asDecimal(850), currency: 'USD' } },
        }),
      );
      const { connectionId } = await helpers.lunchflow.linkManualAccount({ accountId: transferAccount.id });

      const linkResponse = await helpers.linkAccountToBankConnection({
        id: loanAccount.id,
        connectionId,
        externalAccountId: '1002',
      });
      expect(linkResponse.statusCode).toBe(200);

      const { connection } = await helpers.bankDataProviders.getConnectionDetails({ connectionId, raw: true });
      expect(connection.accounts.map((acc) => acc.id).toSorted()).toEqual(
        [transferAccount.id, loanAccount.id].toSorted(),
      );

      await expectDisconnectBlocked({
        connectionId,
        accountId: loanAccount.id,
        loanId: loan.id,
        messagePattern: /delete or reassign them/i,
      });

      const accountsAfter = await helpers.getAccounts();
      expect(accountsAfter.some((acc) => acc.id === transferAccount.id)).toBe(true);

      const partnerAfter = await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.getTransactionById({ id: partnerLeg.id, raw: true }),
      });
      expect(partnerAfter!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
      expect(partnerAfter!.transferId).not.toBeNull();
    }, 60_000);
  });
});

import { API_ERROR_CODES, API_RESPONSE_STATUS, BANK_PROVIDER_TYPE, asDecimal } from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { VALID_LUNCHFLOW_API_KEY, getLunchFlowTransactionsMock } from '@tests/mocks/lunchflow/mock-api';
import { VALID_MONOBANK_TOKEN } from '@tests/mocks/monobank/mock-api';

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
});

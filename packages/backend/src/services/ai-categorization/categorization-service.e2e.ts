import {
  BANK_PROVIDER_TYPE,
  CATEGORIZATION_MODE,
  CATEGORIZATION_SOURCE,
  type ExtractedTransaction,
} from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { VALID_GEMINI_API_KEY, createGeminiMock } from '@tests/mocks/gemini/mock-api';
import { VALID_MONOBANK_TOKEN, getMonobankTransactionsMock } from '@tests/mocks/monobank/mock-api';
import { Op } from 'sequelize';

import { DOMAIN_EVENTS, eventBus } from '../common/event-bus';

/**
 * E2E tests for AI Categorization Service
 *
 * These tests verify the complete flow from bank transaction sync
 * to AI-powered automatic categorization.
 */
describe('AI Categorization Service E2E', () => {
  // Store original env value to restore after tests
  let originalGeminiApiKey: string | undefined;

  beforeEach(() => {
    originalGeminiApiKey = process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    // Restore original env value
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
  });

  describe('Full categorization flow with Monobank', () => {
    it('should NOT categorize transactions when GEMINI_API_KEY is not configured', async () => {
      const MOCK_TRANSACTION_COUNT = 3;

      // Ensure GEMINI_API_KEY is not set
      delete process.env.GEMINI_API_KEY;

      const eventSpy = jest.spyOn(eventBus, 'emit');

      // Step 1: Create a custom category
      await helpers.addCustomCategory({
        name: 'Food',
        color: '#FF0000',
        raw: true,
      });

      // Step 2: Connect to Monobank (no GEMINI_API_KEY set)
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        providerName: 'Test Monobank No AI',
        raw: true,
      });

      // Step 3: List external accounts
      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId,
        raw: true,
      });

      const accountIds = externalAccounts.slice(0, 1).map((acc: { externalId: string }) => acc.externalId);

      // Step 4: Mock Monobank transactions
      global.mswMockServer.use(
        ...accountIds.map((id) =>
          getMonobankTransactionsMock({
            accountId: id,
            response: helpers.monobank.mockedTransactionData(MOCK_TRANSACTION_COUNT),
          }),
        ),
      );

      // Step 5: Connect selected accounts (triggers transaction sync)
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: accountIds,
        raw: true,
      });

      // Step 6: Wait for async processing
      await helpers.sleep(5000);

      // Step 7: Verify transactions were synced but NOT AI-categorized
      const transactions = await Transactions.findAll({
        where: {
          accountId: {
            [Op.in]: syncedAccounts.map((i) => i.id),
          },
        },
        raw: true,
      });

      expect(transactions.length).toBe(MOCK_TRANSACTION_COUNT);

      for (const tx of transactions) {
        expect(tx.categorizationMeta?.source).not.toBe(CATEGORIZATION_SOURCE.ai);
      }

      // The event that puts the AI categorization job on the queue.
      expect(eventSpy).toHaveBeenCalledWith(
        DOMAIN_EVENTS.TRANSACTIONS_SYNCED,
        expect.objectContaining({
          userId: expect.any(Number),
          accountId: expect.any(String),
          transactionIds: expect.arrayContaining([expect.any(String)]),
        }),
      );

      eventSpy.mockRestore();
    });

    it('should gracefully handle AI API errors without failing transaction sync', async () => {
      const MOCK_TRANSACTION_COUNT = 3;

      // Step 1: Create a custom category
      await helpers.addCustomCategory({
        name: 'Transport',
        color: '#0000FF',
        raw: true,
      });

      // Step 2: Set up GEMINI_API_KEY env var
      process.env.GEMINI_API_KEY = VALID_GEMINI_API_KEY;

      // Step 3: Connect to Monobank
      const { connectionId } = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        credentials: { apiToken: VALID_MONOBANK_TOKEN },
        providerName: 'Test Monobank Error',
        raw: true,
      });

      // Step 4: List external accounts
      const { accounts: externalAccounts } = await helpers.bankDataProviders.listExternalAccounts({
        connectionId,
        raw: true,
      });

      const accountIds = externalAccounts.slice(0, 1).map((acc: { externalId: string }) => acc.externalId);

      // Step 5: Mock Monobank transactions
      global.mswMockServer.use(
        ...accountIds.map((id) =>
          getMonobankTransactionsMock({
            accountId: id,
            response: helpers.monobank.mockedTransactionData(MOCK_TRANSACTION_COUNT),
          }),
        ),
      );

      // Step 6: Set up Gemini mock to FAIL
      global.mswMockServer.use(createGeminiMock({ shouldFail: true, errorStatus: 500 }));

      // Step 7: Connect selected accounts
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId,
        accountExternalIds: accountIds,
        raw: true,
      });

      // Step 8: Wait for async processing
      await helpers.sleep(5000);

      // Step 9: Transactions should still be synced even if AI categorization failed
      const transactions = await Transactions.findAll({
        where: {
          accountId: {
            [Op.in]: syncedAccounts.map((i) => i.id),
          },
        },
        raw: true,
      });

      expect(transactions.length).toBe(MOCK_TRANSACTION_COUNT);

      for (const tx of transactions) {
        expect(tx.categorizationMeta?.source).not.toBe(CATEGORIZATION_SOURCE.ai);
      }
    });
  });

  /**
   * The auto-path (bank sync, import) must let the AI revisit a row that already carries a
   * real category from a `hint`-mode Payee rule, while leaving an `enforce`-stamped row alone.
   * Statement import is the cheapest HTTP entry point onto that path: it queues the very same
   * categorization job bank sync does, without a debounce or randomised provider fixtures.
   */
  describe('Payee categorization modes on the auto-path', () => {
    const HINT_MERCHANT = 'Hintworthy Marketplace';
    const ENFORCE_MERCHANT = 'Strictly Coffee';

    async function importOneRowPerPayeeMode() {
      const hintCategory = await helpers.addCustomCategory({ name: 'Hint fallback', color: '#111111', raw: true });
      const enforceCategory = await helpers.addCustomCategory({ name: 'Enforce target', color: '#222222', raw: true });

      await helpers.createPayee({
        payload: {
          name: HINT_MERCHANT,
          defaultCategoryId: hintCategory.id,
          categorizationMode: CATEGORIZATION_MODE.hint,
        },
        raw: true,
      });
      await helpers.createPayee({
        payload: {
          name: ENFORCE_MERCHANT,
          defaultCategoryId: enforceCategory.id,
          categorizationMode: CATEGORIZATION_MODE.enforce,
        },
        raw: true,
      });

      const account = await helpers.createAccount({ raw: true });
      const transactions: ExtractedTransaction[] = [
        {
          date: '2024-03-01 10:00:00',
          description: 'Order 12345',
          merchant: HINT_MERCHANT,
          amount: 42,
          type: 'expense',
        },
        {
          date: '2024-03-02 11:00:00',
          description: 'Flat white',
          merchant: ENFORCE_MERCHANT,
          amount: 5,
          type: 'expense',
        },
      ];

      const { newTransactionIds } = await helpers.statementExecuteImportAndWait({
        payload: { accountId: account.id, transactions, skipIndices: [] },
      });

      expect(newTransactionIds).toHaveLength(2);

      return {
        hintCategory,
        enforceCategory,
        hintTransactionId: newTransactionIds[0]!,
        enforceTransactionId: newTransactionIds[1]!,
      };
    }

    it('leaves a hint-mode row in a real category with no categorization meta', async () => {
      delete process.env.GEMINI_API_KEY;

      const { hintCategory, enforceCategory, hintTransactionId, enforceTransactionId } =
        await importOneRowPerPayeeMode();

      const hintTransaction = await helpers.getTransactionById({ id: hintTransactionId, raw: true });
      expect(hintTransaction?.categoryId).toBe(hintCategory.id);
      expect(hintTransaction?.categorizationMeta).toBeNull();

      const enforceTransaction = await helpers.getTransactionById({ id: enforceTransactionId, raw: true });
      expect(enforceTransaction?.categoryId).toBe(enforceCategory.id);
      expect(enforceTransaction?.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.payeeRule);
    });

    it('lets the AI override the hint-mode row and skips the enforce-stamped one', async () => {
      process.env.GEMINI_API_KEY = VALID_GEMINI_API_KEY;
      // The enforce row carries meta, so the hint row is the run's only candidate: alias t1.
      global.mswMockServer.use(createGeminiMock({ categorizations: { 1: 1 } }));

      const { enforceCategory, hintTransactionId, enforceTransactionId } = await importOneRowPerPayeeMode();

      await helpers.waitForCategorizationStatus({
        predicate: (status) => status.status === 'idle',
        timeoutMs: 15_000,
      });

      const hintTransaction = await helpers.getTransactionById({ id: hintTransactionId, raw: true });
      expect(hintTransaction?.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.ai);

      const enforceTransaction = await helpers.getTransactionById({ id: enforceTransactionId, raw: true });
      expect(enforceTransaction?.categoryId).toBe(enforceCategory.id);
      expect(enforceTransaction?.categorizationMeta?.source).toBe(CATEGORIZATION_SOURCE.payeeRule);
    }, 60_000);
  });
});

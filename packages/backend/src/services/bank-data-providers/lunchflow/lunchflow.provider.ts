import type { RecordId } from '@bt/shared/types';
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ACCOUNT_TYPES,
  BANK_PROVIDER_TYPE,
  Cents,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  asCents,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { BadRequestError, ForbiddenError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { findOneTransaction } from '@models/transactions-query';
import { getUserDefaultCategory } from '@models/users.model';
import {
  BaseBankDataProvider,
  DateRange,
  ProviderAccount,
  ProviderBalance,
  ProviderMetadata,
  ProviderTransaction,
} from '@services/bank-data-providers';
import { createTransaction } from '@services/transactions';
import { accountHasPlannedRows } from '@services/transactions/planned-matching';
import { Op, Sequelize } from 'sequelize';

import { clampSyncStartToLink } from '../utils/clamp-sync-start-to-link';
import { encryptCredentials } from '../utils/credential-encryption';
import { notifyPlannedConfirmations } from '../utils/notify-planned-confirmations';
import { writeBankBalanceWithHistory } from '../utils/write-bank-balance-with-history';
import { LunchFlowApiClient } from './api-client';
import {
  LunchFlowApiAccountsResponse,
  LunchFlowApiTransactionsResponse,
  LunchFlowCredentials,
  LunchFlowMetadata,
} from './types';

/**
 * LunchFlow provider implementation
 * Handles integration with LunchFlow API for multi-bank account access worldwide
 */
export class LunchFlowProvider extends BaseBankDataProvider {
  readonly metadata: ProviderMetadata = {
    type: BANK_PROVIDER_TYPE.LUNCHFLOW,
    name: 'Lunch Flow',
    description: 'Sync transactions from 20,000+ banks worldwide via LunchFlow',
    features: {
      supportsWebhooks: false,
      supportsRealtime: false,
      requiresReauth: false,
      supportsManualSync: true,
      supportsAutoSync: true,
      defaultSyncInterval: 12 * 60 * 60 * 1000, // 12 hours
      minSyncInterval: 5 * 60 * 1000, // 5 minutes
    },
  };

  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(userId: number, credentials: unknown): Promise<string> {
    if (!this.isValidCredentials(credentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.lunchflow.invalidCredentialsFormat' }) });
    }

    const { apiKey } = credentials;

    const isValid = await this.validateCredentials(credentials);
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.lunchflow.invalidApiKey' }) });
    }

    const apiClient = new LunchFlowApiClient(apiKey);
    const { accounts } = await apiClient.getAccounts();

    // Generate connection name with counter for multiple connections
    const existingConnections = await BankDataProviderConnections.count({
      where: { userId, providerType: this.metadata.type },
    });
    const providerName = existingConnections > 0 ? `LunchFlow (${existingConnections + 1})` : 'LunchFlow';

    const connection = await BankDataProviderConnections.create({
      userId,
      providerType: this.metadata.type,
      providerName,
      isActive: true,
      credentials: encryptCredentials({ apiKey }),
      metadata: {
        accountCount: accounts.length,
        consecutiveAuthFailures: 0,
        deactivationReason: null,
      } as LunchFlowMetadata,
    } as any);

    return connection.id;
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    await connection.destroy();
  }

  async validateCredentials(credentials: unknown): Promise<boolean> {
    if (!this.isValidCredentials(credentials)) {
      return false;
    }

    const apiClient = new LunchFlowApiClient(credentials.apiKey);

    // testConnection returns false only for 401/403.
    // Network/5xx errors propagate so callers can distinguish "invalid key"
    // from "provider is down".
    return await apiClient.testConnection();
  }

  async refreshCredentials(connectionId: string, newCredentials: unknown): Promise<void> {
    if (!this.isValidCredentials(newCredentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.lunchflow.invalidCredentialsFormat' }) });
    }

    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    const isValid = await this.validateCredentials(newCredentials);
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.lunchflow.invalidApiKey' }) });
    }

    connection.setEncryptedCredentials({ apiKey: newCredentials.apiKey });

    // New object reference: mutating metadata in place leaves the JSONB column clean and the reset is never saved.
    const metadata: LunchFlowMetadata = { ...(connection.metadata as LunchFlowMetadata) };
    metadata.consecutiveAuthFailures = 0;
    metadata.deactivationReason = null;
    connection.metadata = metadata as any;
    connection.isActive = true;

    await connection.save();
  }

  // ============================================================================
  // Account Operations
  // ============================================================================

  async fetchAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const { apiKey } = await this.getValidatedCredentials(connectionId);

    const apiClient = new LunchFlowApiClient(apiKey);

    let accountsResponse: LunchFlowApiAccountsResponse;
    try {
      accountsResponse = await apiClient.getAccounts();
      await this.resetAuthFailures(connectionId);
    } catch (error) {
      await this.handleAuthError({ connectionId, error });
      throw error;
    }

    // Only return ACTIVE accounts (include accounts with no status — benefit of the doubt)
    const activeAccounts = accountsResponse.accounts.filter((acc) => !acc.status || acc.status === 'ACTIVE');

    // Fetch balances in parallel to avoid N+1 sequential API calls
    // Balance response also provides the currency for each account
    const balanceResults = await Promise.allSettled(
      activeAccounts.map((account) => apiClient.getBalance({ accountId: account.id })),
    );

    // Per-account balance failures are expected (fall back to 0). But when
    // most accounts in one sync fail simultaneously, that's a strong signal
    // the balance API itself is degraded — escalate to Sentry. Min count of 2
    // avoids firing for single-account connections where one bad account
    // would otherwise look like a 100% failure rate.
    const rejectedCount = balanceResults.filter((r) => r.status === 'rejected').length;
    if (rejectedCount >= 2 && rejectedCount / activeAccounts.length > 0.5) {
      logger.error(
        {
          message: '[LunchFlow] Majority of balance fetches failed in a single sync. Possible API degradation.',
        },
        {
          connectionId,
          rejectedCount,
          accountCount: activeAccounts.length,
        },
      );
    }

    return activeAccounts.reduce<ProviderAccount[]>((result, account, index) => {
      const balanceResult = balanceResults[index]!;
      let balance: Cents = asCents(0);
      // Use account-level currency as fallback; balance response takes precedence
      let currency = account.currency || '';
      if (balanceResult.status === 'fulfilled') {
        balance = Money.fromDecimal(balanceResult.value.balance.amount).toCents();
        currency = balanceResult.value.balance.currency || currency;
      } else {
        const reason =
          balanceResult.reason instanceof Error ? balanceResult.reason.message : String(balanceResult.reason);
        logger.info(`[LunchFlow] Failed to fetch balance for account ${account.id}, defaulting to 0: ${reason}`);
      }

      if (!currency) {
        logger.error({
          message: `[LunchFlow] Skipping account ${account.id} (${account.name}): no currency available from account or balance response`,
        });
        return result;
      }

      result.push({
        externalId: String(account.id),
        name: account.name,
        type: 'bank' as const,
        balance,
        currency,
        metadata: {
          institutionName: account.institution_name,
          institutionLogo: account.institution_logo,
          provider: account.provider,
          status: account.status,
        },
      });
      return result;
    }, []);
  }

  // ============================================================================
  // Transaction Operations
  // ============================================================================

  async fetchTransactions(
    connectionId: string,
    accountExternalId: string,
    _dateRange?: DateRange, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<ProviderTransaction[]> {
    const { apiKey } = await this.getValidatedCredentials(connectionId);

    const apiClient = new LunchFlowApiClient(apiKey);
    const accountId = parseInt(accountExternalId, 10);
    const { transactions } = await apiClient.getTransactions({ accountId });

    return transactions
      .filter((tx) => tx.id !== null)
      .map((tx) => ({
        externalId: tx.id!,
        amount: Money.fromDecimal(tx.amount).toCents(),
        currency: tx.currency,
        date: new Date(tx.date),
        description: tx.description || tx.merchant || '',
        merchantName: tx.merchant,
        metadata: {
          merchant: tx.merchant,
          description: tx.description,
          lunchflowAccountId: tx.accountId,
        },
      }));
  }

  async syncTransactions({
    connectionId,
    systemAccountId,
    userId,
  }: {
    connectionId: string;
    systemAccountId: RecordId;
    userId: number;
  }): Promise<void> {
    await this.runSyncWithStatus({
      systemAccountId,
      userId,
      connectionId,
      errorLogMessage: '[LunchFlow] Sync error:',
      work: async () => {
        const account = await this.getSystemAccount(systemAccountId);
        const connection = await this.getConnection(connectionId);
        this.validateProviderType(connection);

        if (!account.externalId) {
          throw new BadRequestError({ message: t({ key: 'bankDataProviders.lunchflow.accountNoExternalId' }) });
        }

        const { apiKey } = await this.getValidatedCredentials(connectionId);
        const apiClient = new LunchFlowApiClient(apiKey);
        const accountId = parseInt(account.externalId, 10);

        let transactionsResponse: LunchFlowApiTransactionsResponse;
        try {
          transactionsResponse = await apiClient.getTransactions({ accountId });
          await this.resetAuthFailures(connectionId);
        } catch (error) {
          await this.handleAuthError({ connectionId, error });
          throw error;
        }

        // Filter out pending transactions (those with null IDs)
        const postedTransactions = transactionsResponse.transactions.filter((tx) => tx.id !== null);

        // Sort by date ascending
        postedTransactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const defaultCategoryId = await getUserDefaultCategory({ id: connection.userId });
        const createdTransactionIds: string[] = [];
        let mergedIntoPlannedCount = 0;
        let skippedPreLinkCount = 0;
        const checkpoint = this.createBaseCurrencyLockCheckpoint({ userId });

        // An account with nothing stored yet is a backfill: it imports the whole feed and
        // must not consume plans. Otherwise only rows since the link date are created, never
        // since the newest stored row: LunchFlow sends the whole feed every sync, and a row
        // the bank reveals later under an earlier date would be dropped for good.
        const anyStoredTransaction = await findOneTransaction({
          planned: 'exclude',
          access: 'unscoped-internal',
          balanceAdjustments: 'include',
          where: { accountId: account.id, time: { [Op.lte]: new Date() } },
        });
        const createFromDate = anyStoredTransaction
          ? clampSyncStartToLink({ account, from: new Date(0) })
          : new Date(0);
        const matchPlanned = Boolean(anyStoredTransaction) && (await accountHasPlannedRows({ accountId: account.id }));

        for (const tx of postedTransactions) {
          await checkpoint();

          // Primary dedup: check by originalId (covers normal re-sync)
          const existingTx = await findOneTransaction({
            planned: 'exclude',
            access: 'unscoped-internal',
            balanceAdjustments: 'include',
            where: {
              accountId: account.id,
              originalId: tx.id!,
            },
            paranoid: false,
          });

          if (existingTx) {
            continue;
          }

          // Secondary dedup: check externalData.originalSource.originalId
          // This covers the unlink→relink flow where originalId was cleared to null
          // but the original value was preserved in externalData
          const existingByOriginalSource = await findOneTransaction({
            planned: 'exclude',
            access: 'unscoped-internal',
            balanceAdjustments: 'include',
            where: Sequelize.and(
              { accountId: account.id, originalId: null },
              Sequelize.where(Sequelize.literal(`"externalData"#>>'{originalSource,originalId}'`), tx.id!),
            ),
            paranoid: false,
          });

          if (existingByOriginalSource) {
            // Restore the originalId so future syncs use the fast primary path
            await existingByOriginalSource.update({ originalId: tx.id! });
            continue;
          }

          // Never create rows before the link date: that history is already absorbed into the opening balance.
          if (new Date(tx.date) < createFromDate) {
            skippedPreLinkCount += 1;
            continue;
          }

          const isExpense = tx.amount < 0;

          const createResult = await createTransaction({
            originalId: tx.id!,
            note: tx.description || tx.merchant || '',
            amount: Money.fromDecimal(Math.abs(tx.amount)),
            time: new Date(tx.date),
            externalData: {
              merchant: tx.merchant,
              description: tx.description,
              lunchflowAccountId: tx.accountId,
            },
            commissionRate: Money.fromCents(0),
            cashbackAmount: Money.fromCents(0),
            accountId: account.id,
            userId: connection.userId,
            transactionType: isExpense ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
            paymentType: PAYMENT_TYPES.bankTransfer,
            categoryId: defaultCategoryId,
            transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
            accountType: ACCOUNT_TYPES.lunchflow,
            rawMerchantName: tx.merchant?.trim() || null,
            matchPlanned,
          });

          // A merged row is not a new row: it keeps the user's category and payee, which the
          // post-sync listeners on the emitted ids would overwrite.
          if (createResult.mergedIntoPlanned) {
            mergedIntoPlannedCount += 1;
          } else {
            createdTransactionIds.push(createResult[0].id);
          }
        }

        if (createdTransactionIds.length > 0 || mergedIntoPlannedCount > 0 || skippedPreLinkCount > 0) {
          logger.info(
            `[LunchFlow] Sync: ${createdTransactionIds.length} transactions created, ${mergedIntoPlannedCount} planned confirmed, ${skippedPreLinkCount} pre-link rows skipped for account ${account.id}`,
          );
          await notifyPlannedConfirmations({
            userId: connection.userId,
            accountId: account.id,
            mergedCount: mergedIntoPlannedCount,
          });
        }

        // Update account balance
        try {
          const balanceResponse = await apiClient.getBalance({ accountId });
          const balanceMoney = Money.fromDecimal(balanceResponse.balance.amount);
          await writeBankBalanceWithHistory({ account, balance: balanceMoney });
        } catch (error) {
          // Info-only: transactions are already synced; next sync retries the balance.
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.info(`[LunchFlow] Failed to update balance for account ${account.id}: ${errorMsg}`);
        }

        return { transactionIds: createdTransactionIds };
      },
    });
  }

  // ============================================================================
  // Balance Operations
  // ============================================================================

  async fetchBalance(connectionId: string, accountExternalId: string): Promise<ProviderBalance> {
    const { apiKey } = await this.getValidatedCredentials(connectionId);

    const apiClient = new LunchFlowApiClient(apiKey);
    const accountId = parseInt(accountExternalId, 10);
    const { balance } = await apiClient.getBalance({ accountId });

    return {
      amount: Money.fromDecimal(balance.amount).toCents(),
      currency: balance.currency,
      asOf: new Date(),
    };
  }

  async refreshBalance(connectionId: string, systemAccountId: string): Promise<void> {
    const account = await this.getSystemAccount(systemAccountId);

    if (!account.externalId) {
      throw new BadRequestError({ message: t({ key: 'bankDataProviders.lunchflow.accountNoExternalId' }) });
    }

    const balance = await this.fetchBalance(connectionId, account.externalId);

    await writeBankBalanceWithHistory({ account, balance: Money.fromCents(balance.amount) });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private isValidCredentials(credentials: unknown): credentials is LunchFlowCredentials {
    if (typeof credentials !== 'object' || credentials === null || !('apiKey' in credentials)) {
      return false;
    }
    const { apiKey } = credentials as Record<string, unknown>;
    return typeof apiKey === 'string' && apiKey.length > 0;
  }

  private async getValidatedCredentials(connectionId: string): Promise<LunchFlowCredentials> {
    const credentials = await this.getDecryptedCredentials(connectionId);
    if (!this.isValidCredentials(credentials)) {
      throw new ValidationError({
        message: t({ key: 'bankDataProviders.lunchflow.invalidCredentialsFormat' }),
      });
    }
    return credentials;
  }
}

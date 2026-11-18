import type { RecordId } from '@bt/shared/types';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BANK_PROVIDER_TYPE, Cents } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { BadRequestError, ForbiddenError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { BaseBankDataProvider, ProviderAccount, ProviderMetadata } from '@services/bank-data-providers';

import { PROVIDER_TO_ACCOUNT_TYPE } from '../types';
import { clampSyncStartToLink } from '../utils/clamp-sync-start-to-link';
import { encryptCredentials } from '../utils/credential-encryption';
import { findSyncAnchor } from '../utils/find-sync-anchor';
import { persistSyncedTransactions } from '../utils/persist-synced-transactions';
import { writeBankBalanceWithHistory } from '../utils/write-bank-balance-with-history';
import { LunchFlowApiClient } from './api-client';
import { LunchFlowApiBalance, LunchFlowCredentials, LunchFlowMetadata } from './types';

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

    const providerName = await this.nextConnectionName({ userId, label: 'LunchFlow' });

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

    this.reactivateConnection({ connection });

    await connection.save();
  }

  // ============================================================================
  // Account Operations
  // ============================================================================

  async fetchAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const { apiKey } = await this.getValidatedCredentials(connectionId);

    const apiClient = new LunchFlowApiClient(apiKey);

    const accountsResponse = await this.withAuthTracking({ connectionId, request: () => apiClient.getAccounts() });

    // Only return ACTIVE accounts (include accounts with no status — benefit of the doubt)
    const activeAccounts = accountsResponse.accounts.filter((acc) => !acc.status || acc.status === 'ACTIVE');

    // Fetch balances in parallel to avoid N+1 sequential API calls
    // Balance response also provides the currency for each account
    const balanceResults = await Promise.allSettled(
      activeAccounts.map((account) => apiClient.getBalance({ accountId: account.id })),
    );

    // Per-account balance failures are expected (balance unknown). But when
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

    const accounts = activeAccounts.reduce<ProviderAccount[]>((result, account, index) => {
      const balanceResult = balanceResults[index]!;
      let balance: Cents | null = null;
      // Use account-level currency as fallback; balance response takes precedence
      let currency = account.currency || '';
      if (balanceResult.status === 'fulfilled') {
        balance = Money.fromDecimal(balanceResult.value.balance.amount).toCents();
        currency = balanceResult.value.balance.currency || currency;
      } else {
        const reason =
          balanceResult.reason instanceof Error ? balanceResult.reason.message : String(balanceResult.reason);
        logger.info(`[LunchFlow] Failed to fetch balance for account ${account.id}, balance unknown: ${reason}`);
      }

      if (!currency) {
        const balanceCurrency =
          balanceResult.status === 'fulfilled'
            ? JSON.stringify(balanceResult.value.balance.currency)
            : 'balance fetch failed';
        logger.info(
          `[LunchFlow] Skipping account ${account.id} (${account.name}): no currency available from account or balance response (account.currency=${JSON.stringify(account.currency)}, balance.currency=${balanceCurrency})`,
        );
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

    const skippedCount = activeAccounts.length - accounts.length;
    if (skippedCount >= 2 && skippedCount / activeAccounts.length > 0.5) {
      logger.error(
        { message: '[LunchFlow] Majority of accounts skipped for missing currency. Possible API change.' },
        { connectionId, skippedCount, accountCount: activeAccounts.length },
      );
    }

    return accounts;
  }

  // ============================================================================
  // Transaction Operations
  // ============================================================================

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

        const transactionsResponse = await this.withAuthTracking({
          connectionId,
          request: () => apiClient.getTransactions({ accountId }),
        });

        // Filter out pending transactions (those with null IDs)
        const postedTransactions = transactionsResponse.transactions.filter((tx) => tx.id !== null);

        // Sort by date ascending
        postedTransactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // An account with nothing stored yet is a backfill: it imports the whole feed and
        // must not consume plans. Otherwise only rows since the link date are created, never
        // since the newest stored row: LunchFlow sends the whole feed every sync, and a row
        // the bank reveals later under an earlier date would be dropped for good.
        const hasHistory = (await findSyncAnchor({ account, to: new Date() })) !== null;
        const createFromDate = hasHistory ? clampSyncStartToLink({ account, from: new Date(0) }) : new Date(0);

        const { createdTransactionIds, mergedIntoPlannedCount, skippedPreLinkCount } = await persistSyncedTransactions({
          account,
          userId: connection.userId,
          accountType: PROVIDER_TO_ACCOUNT_TYPE[this.metadata.type],
          checkpoint: this.createBaseCurrencyLockCheckpoint({ userId: connection.userId }),
          rows: postedTransactions.map((tx) => ({
            originalId: tx.id!,
            time: new Date(tx.date),
            amount: tx.amount,
            note: tx.description || tx.merchant || '',
            externalData: {
              merchant: tx.merchant,
              description: tx.description,
              lunchflowAccountId: tx.accountId,
            },
            rawMerchantName: tx.merchant?.trim() || null,
          })),
          matchPlanned: hasHistory,
          createFromDate,
        });

        if (createdTransactionIds.length > 0 || mergedIntoPlannedCount > 0 || skippedPreLinkCount > 0) {
          logger.info(
            `[LunchFlow] Sync: ${createdTransactionIds.length} transactions created, ${mergedIntoPlannedCount} planned confirmed, ${skippedPreLinkCount} pre-link rows skipped for account ${account.id}`,
          );
        }

        let balanceResponse: LunchFlowApiBalance | null = null;
        try {
          balanceResponse = await apiClient.getBalance({ accountId });
        } catch (error) {
          // Info-only: transactions are already synced; next sync retries the balance.
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.info(`[LunchFlow] Failed to fetch balance for account ${account.id}: ${errorMsg}`);
        }
        if (balanceResponse) {
          await writeBankBalanceWithHistory({ account, balance: Money.fromDecimal(balanceResponse.balance.amount) });
        }

        return { transactionIds: createdTransactionIds };
      },
    });
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

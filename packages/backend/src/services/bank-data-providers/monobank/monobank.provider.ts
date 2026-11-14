import type { RecordId } from '@bt/shared/types';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { ExternalMonobankClientInfoResponse } from '@bt/shared/types/external-services';
import { t } from '@i18n/index';
import { BadRequestError, ForbiddenError, ValidationError } from '@js/errors';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { BaseBankDataProvider, ProviderAccount, ProviderMetadata } from '@services/bank-data-providers';
import cc from 'currency-codes';

import { encryptCredentials } from '../utils/credential-encryption';
import { resolveSyncStart } from '../utils/resolve-sync-start';
import { MonobankApiClient } from './api-client';
import { queueTransactionSync, syncPriorityForAccount } from './transaction-sync-queue';
import { MonobankCredentials } from './types';

/**
 * Monobank provider implementation
 * Handles integration with Monobank API for account and transaction syncing
 */
export class MonobankProvider extends BaseBankDataProvider {
  readonly metadata: ProviderMetadata = {
    type: BANK_PROVIDER_TYPE.MONOBANK,
    name: 'Monobank',
    description: 'Ukrainian digital bank with API access for personal finance tracking',
    features: {
      supportsWebhooks: true,
      supportsRealtime: true,
      requiresReauth: false,
      supportsManualSync: true,
      supportsAutoSync: true,
      queuedSync: true,
      defaultSyncInterval: 4 * 60 * 60 * 1000, // 4 hours
      minSyncInterval: 60 * 1000, // 1 minute (Monobank API rate limit)
    },
  };

  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(userId: number, credentials: unknown): Promise<string> {
    // Validate credentials structure
    if (!this.isValidCredentials(credentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.monobank.invalidCredentialsFormat' }) });
    }

    const { apiToken } = credentials;

    // Validate token by calling Monobank API
    const isValid = await this.validateCredentials(credentials);
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.monobank.invalidApiToken' }) });
    }

    const apiClient = new MonobankApiClient(apiToken);
    // Get client info from Monobank (bypass cache to ensure fresh data during connection)
    const clientInfo = await apiClient.getClientInfo({ bypassCache: true });

    // Create connection in database
    const connection = await BankDataProviderConnections.create({
      userId,
      providerType: this.metadata.type,
      providerName: clientInfo.name || 'Monobank Account',
      isActive: true,
      credentials: encryptCredentials({ apiToken }),
      metadata: {
        clientId: clientInfo.clientId,
        webHookUrl: clientInfo.webHookUrl,
        userName: clientInfo.name,
      },
    } as any);

    return connection.id;
  }

  async validateCredentials(credentials: unknown): Promise<boolean> {
    if (!this.isValidCredentials(credentials)) {
      return false;
    }

    const { apiToken } = credentials;
    const apiClient = new MonobankApiClient(apiToken);

    // testConnection returns false only for a genuine auth failure.
    // Network/5xx/429 errors propagate so callers can distinguish "invalid token"
    // from "provider is down".
    return await apiClient.testConnection();
  }

  async refreshCredentials(connectionId: string, newCredentials: unknown): Promise<void> {
    if (!this.isValidCredentials(newCredentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.monobank.invalidCredentialsFormat' }) });
    }

    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    // Validate new credentials
    const isValid = await this.validateCredentials(newCredentials);
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.monobank.invalidApiToken' }) });
    }

    // Update credentials - newCredentials is validated as MonobankCredentials, cast to Record for encryption
    connection.setEncryptedCredentials(newCredentials as unknown as Record<string, unknown>);

    this.reactivateConnection({ connection });

    await connection.save();
  }

  // ============================================================================
  // Account Operations
  // ============================================================================

  async fetchAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const { apiToken } = await this.getValidatedCredentials(connectionId);

    const apiClient = new MonobankApiClient(apiToken);
    const clientInfo = await apiClient.getClientInfo();

    return this.transformMonobankAccounts(clientInfo);
  }

  // ============================================================================
  // Transaction Operations
  // ============================================================================

  /**
   * Sync transactions (queue-based for Monobank)
   * Automatically determines date range from most recent transaction or last 31 days
   */
  async syncTransactions({
    connectionId,
    systemAccountId,
    userId,
  }: {
    connectionId: string;
    systemAccountId: RecordId;
    userId: number;
  }): Promise<{ jobGroupId: string; totalBatches: number; estimatedMinutes: number }> {
    // The worker (transaction-sync-queue) advances QUEUED → SYNCING → COMPLETED
    // once it picks up the job, so runQueuedSync only owns QUEUED and FAILED here.
    return this.runQueuedSync({
      systemAccountId,
      userId,
      enqueue: async () => {
        const account = await this.getSystemAccount(systemAccountId);

        const to = new Date();
        // Anchorless accounts backfill the provider's 31-day maximum: there is nothing to
        // collide with, and the deferred residual absorb explains whatever the backfill doesn't.
        const { anchor, from, matchPlanned } = await resolveSyncStart({ account, to, backfillDays: 31 });

        return this.enqueueTransactionSync({
          connectionId,
          systemAccountId,
          userId,
          from,
          to,
          matchPlanned,
          priority: syncPriorityForAccount({ latestTransactionTime: anchor }),
        });
      },
    });
  }

  /**
   * Load transactions for a specific date period using queue system
   * Handles Monobank rate limits and splits into 31-day chunks
   */
  async loadTransactionsForPeriod({
    connectionId,
    systemAccountId,
    userId,
    from,
    to,
  }: {
    connectionId: string;
    systemAccountId: RecordId;
    userId: number;
    from: Date;
    to: Date;
  }): Promise<{ jobGroupId: string; totalBatches: number; estimatedMinutes: number }> {
    // No `matchPlanned`: a charge from an arbitrary past window must not consume a plan
    // the user made for something else.
    return this.enqueueTransactionSync({ connectionId, systemAccountId, userId, from, to });
  }

  private async enqueueTransactionSync({
    connectionId,
    systemAccountId,
    userId,
    from,
    to,
    matchPlanned = false,
    priority,
  }: {
    connectionId: string;
    systemAccountId: RecordId;
    userId: number;
    from: Date;
    to: Date;
    matchPlanned?: boolean;
    priority?: number;
  }): Promise<{ jobGroupId: string; totalBatches: number; estimatedMinutes: number }> {
    const account = await this.getSystemAccount(systemAccountId);
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    if (!account.externalId) {
      throw new BadRequestError({ message: t({ key: 'accounts.accountNoExternalIdMonobank' }) });
    }

    const { apiToken } = await this.getValidatedCredentials(connectionId);

    // Queue the transaction sync job
    const result = await queueTransactionSync({
      userId,
      accountId: account.id,
      connectionId,
      externalAccountId: account.externalId,
      apiToken,
      from,
      to,
      matchPlanned,
      priority,
    });

    return result;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Type guard for Monobank credentials
   */
  private isValidCredentials(credentials: unknown): credentials is MonobankCredentials {
    return (
      typeof credentials === 'object' &&
      credentials !== null &&
      'apiToken' in credentials &&
      typeof (credentials as any).apiToken === 'string' &&
      (credentials as any).apiToken.length > 0
    );
  }

  private async getValidatedCredentials(connectionId: string): Promise<MonobankCredentials> {
    const credentials = await this.getDecryptedCredentials(connectionId);
    if (!this.isValidCredentials(credentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.monobank.invalidCredentialsFormat' }) });
    }
    return credentials;
  }

  /**
   * Transform Monobank API response to ProviderAccount format
   */
  private transformMonobankAccounts(clientInfo: ExternalMonobankClientInfoResponse): ProviderAccount[] {
    return clientInfo.accounts.map((account) => ({
      externalId: account.id,
      name: this.getAccountName(account),
      type: account.type,
      balance: account.balance,
      currency: this.getCurrencyCodeFromMonobank(account.currencyCode),
      metadata: {
        creditLimit: account.creditLimit,
        currencyCode: account.currencyCode,
        cashbackType: account.cashbackType,
        maskedPan: account.maskedPan,
        iban: account.iban,
        sendId: account.sendId,
      },
    }));
  }

  /**
   * Generate a user-friendly account name
   */
  private getAccountName(account: ExternalMonobankClientInfoResponse['accounts'][0]): string {
    const cardType = this.formatCardType(account.type);
    const lastFourDigits = account.maskedPan[0]?.slice(-4) || '';

    if (lastFourDigits) {
      return `${cardType} ****${lastFourDigits}`;
    }

    return cardType;
  }

  /**
   * Format Monobank card type to user-friendly name
   */
  private formatCardType(type: string): string {
    const typeMap: Record<string, string> = {
      black: 'Black Card',
      white: 'White Card',
      platinum: 'Platinum Card',
      iron: 'Iron Card',
      fop: 'FOP Card',
      yellow: 'Yellow Card',
      eAid: 'eAid Card',
    };

    return typeMap[type] || type;
  }

  /**
   * Convert Monobank currency code (ISO 4217 numeric) to string code
   * @param numericCode - Numeric currency code from Monobank
   * @returns Currency code string (e.g., 'UAH', 'USD')
   */
  private getCurrencyCodeFromMonobank(numericCode: number): string {
    const currency = cc.number(String(numericCode));
    if (!currency) {
      throw new ValidationError({
        message: t({ key: 'bankDataProviders.monobank.unknownCurrencyCode', variables: { numericCode } }),
      });
    }
    return currency.code;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import { BANK_PROVIDER_TYPE, type RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { BadRequestError, ForbiddenError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { findOneTransaction } from '@models/transactions-query';
import { BaseBankDataProvider, type ProviderAccount, type ProviderMetadata } from '@services/bank-data-providers';
import { Op } from 'sequelize';

import { PROVIDER_TO_ACCOUNT_TYPE } from '../types';
import { clampSyncStartToLink } from '../utils/clamp-sync-start-to-link';
import { encryptCredentials } from '../utils/credential-encryption';
import { findSyncAnchor } from '../utils/find-sync-anchor';
import { persistSyncedTransactions } from '../utils/persist-synced-transactions';
import { writeBankBalanceWithHistory } from '../utils/write-bank-balance-with-history';
import { AkahuApiClient } from './api-client';
import type { AkahuApiAccount, AkahuApiTransaction, AkahuCredentials, AkahuMetadata } from './types';

/**
 * Personal-app data is refreshed by Akahu on a daily schedule. Only ask for an
 * on-demand refresh when the cached view is older than this; the manual-refresh
 * rest period is 1h and excessive refresh requests are an abuse vector, so at
 * most ~one request per day per connection.
 */
const STALE_DATA_THRESHOLD_MS = 20 * 60 * 60 * 1000;

/**
 * NZ banks settle rows days late under earlier dates, so the incremental window
 * reaches this far behind the newest imported row. `originalId` dedup absorbs the refetch.
 */
const INCREMENTAL_OVERLAP_MS = 14 * 24 * 60 * 60 * 1000;

/** Docs: https://developers.akahu.nz/docs/personal-apps */
export class AkahuProvider extends BaseBankDataProvider {
  readonly metadata: ProviderMetadata = {
    type: BANK_PROVIDER_TYPE.AKAHU,
    name: 'Akahu',
    description: 'Sync transactions from New Zealand banks for free via an Akahu personal app',
    documentationUrl: 'https://developers.akahu.nz/docs/personal-apps',
    features: {
      supportsWebhooks: false, // webhooks require a full Akahu app; personal apps don't get them
      supportsRealtime: false,
      requiresReauth: false,
      supportsManualSync: true,
      supportsAutoSync: true,
      defaultSyncInterval: 12 * 60 * 60 * 1000, // 12 hours
      minSyncInterval: 5 * 60 * 1000, // 5 minutes
    },
  };

  async connect(userId: number, credentials: unknown): Promise<string> {
    if (!this.isValidCredentials(credentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.akahu.invalidCredentialsFormat' }) });
    }

    const isValid = await this.validateCredentials(credentials);
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.akahu.invalidTokens' }) });
    }

    const accountsResponse = await new AkahuApiClient(credentials).getAccounts();

    const providerName = await this.nextConnectionName({ userId, label: 'Akahu' });

    const connection = await BankDataProviderConnections.create({
      userId,
      providerType: this.metadata.type,
      providerName,
      isActive: true,
      credentials: encryptCredentials({ userToken: credentials.userToken, appToken: credentials.appToken }),
      metadata: {
        accountCount: accountsResponse.items.length,
        consecutiveAuthFailures: 0,
        deactivationReason: null,
      } satisfies AkahuMetadata,
    } as any);

    return connection.id;
  }

  async validateCredentials(credentials: unknown): Promise<boolean> {
    if (!this.isValidCredentials(credentials)) {
      return false;
    }

    const apiClient = new AkahuApiClient(credentials);
    return await apiClient.testConnection();
  }

  async refreshCredentials(connectionId: string, newCredentials: unknown): Promise<void> {
    if (!this.isValidCredentials(newCredentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.akahu.invalidCredentialsFormat' }) });
    }

    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    const isValid = await this.validateCredentials(newCredentials);
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.akahu.invalidTokens' }) });
    }

    connection.setEncryptedCredentials({
      userToken: newCredentials.userToken,
      appToken: newCredentials.appToken,
    });

    this.reactivateConnection({ connection });

    await connection.save();
  }

  async fetchAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const credentials = await this.getValidatedCredentials(connectionId);
    const apiClient = new AkahuApiClient(credentials);

    const accountsResponse = await this.withAuthTracking({ connectionId, request: () => apiClient.getAccounts() });

    return accountsResponse.items
      .filter((account) => account.status === 'ACTIVE')
      .map((account) => this.toProviderAccount(account))
      .filter((account): account is ProviderAccount => account !== null);
  }

  private toProviderAccount(account: AkahuApiAccount): ProviderAccount | null {
    const currency = account.balance.currency?.toUpperCase();
    if (!currency) {
      logger.error({
        message: `[Akahu] Skipping account ${account._id} (${account.name}): no currency in balance payload`,
      });
      return null;
    }

    return {
      externalId: account._id,
      name: account.name,
      type: 'bank' as const,
      balance: account.balance.current == null ? null : Money.fromDecimal(account.balance.current).toCents(),
      currency,
      metadata: {
        institutionName: account.connection?.name ?? null,
        institutionLogo: account.connection?.logo ?? null,
        akahuType: account.type,
        accountNumber: account.formatted_account ?? null,
        holder: account.meta?.holder ?? null,
        status: account.status,
        creditLimit: account.balance.limit ? Money.fromDecimal(Math.abs(account.balance.limit)).toCents() : 0,
      },
    };
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
      errorLogMessage: '[Akahu] Sync error:',
      work: async () => {
        const account = await this.getSystemAccount(systemAccountId);
        const connection = await this.getConnection(connectionId);
        this.validateProviderType(connection);

        if (!account.externalId) {
          throw new BadRequestError({ message: t({ key: 'bankDataProviders.akahu.accountNoExternalId' }) });
        }

        const credentials = await this.getValidatedCredentials(connectionId);
        const apiClient = new AkahuApiClient(credentials);

        // An account with nothing stored yet is a backfill: fetch everything
        // Akahu serves for a personal app (730 days) and don't consume plans.
        const hasHistory = (await findSyncAnchor({ account, to: new Date() })) !== null;
        const newestImported =
          hasHistory &&
          (await findOneTransaction({
            planned: 'exclude',
            access: 'unscoped-internal',
            balanceAdjustments: 'include',
            where: { accountId: account.id, originalId: { [Op.ne]: null }, time: { [Op.lte]: new Date() } },
            order: [['time', 'DESC']],
          }));
        const start = newestImported
          ? new Date(new Date(newestImported.time).getTime() - INCREMENTAL_OVERLAP_MS)
          : undefined;

        const externalId = account.externalId;
        // One tracked block: a reset after the account read would hide a rejected transactions read.
        const { akahuAccount, fetched } = await this.withAuthTracking({
          connectionId,
          request: async () => ({
            akahuAccount: (await apiClient.getAccount({ accountId: externalId })).item,
            fetched: await apiClient.getTransactions({ accountId: externalId, start }),
          }),
        });
        await this.requestRefreshIfStale({ apiClient, account: akahuAccount });

        const counters = await persistSyncedTransactions({
          account,
          userId: connection.userId,
          accountType: PROVIDER_TO_ACCOUNT_TYPE[this.metadata.type],
          checkpoint: this.createBaseCurrencyLockCheckpoint({ userId: connection.userId }),
          // Ledger order, so planned-merge sees transactions ascending.
          rows: fetched
            .toSorted((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map((tx) => ({
              originalId: tx._id,
              time: new Date(tx.date),
              amount: tx.amount,
              note: tx.description || tx.merchant?.name || '',
              externalData: this.transactionMetadata(tx),
              rawMerchantName: tx.merchant?.name?.trim() || null,
            })),
          matchPlanned: hasHistory,
          createFromDate: hasHistory ? clampSyncStartToLink({ account, from: new Date(0) }) : new Date(0),
        });

        if (
          counters.createdTransactionIds.length > 0 ||
          counters.mergedIntoPlannedCount > 0 ||
          counters.skippedPreLinkCount > 0
        ) {
          logger.info(
            `[Akahu] Sync: ${counters.createdTransactionIds.length} transactions created, ${counters.mergedIntoPlannedCount} planned confirmed, ${counters.skippedPreLinkCount} pre-link rows skipped for account ${account.id}`,
          );
        }

        if (akahuAccount.balance.current != null) {
          await writeBankBalanceWithHistory({ account, balance: Money.fromDecimal(akahuAccount.balance.current) });
        }

        return { transactionIds: counters.createdTransactionIds, fetchedCount: fetched.length };
      },
    });
  }

  private transactionMetadata(tx: AkahuApiTransaction): Record<string, unknown> {
    return {
      akahuType: tx.type,
      merchant: tx.merchant?.name ?? null,
      merchantId: tx.merchant?._id ?? null,
      category: tx.category?.name ?? null,
      categoryGroup: tx.category?.groups?.personal_finance?.name ?? null,
      particulars: tx.meta?.particulars ?? null,
      reference: tx.meta?.reference ?? null,
      cardSuffix: tx.meta?.card_suffix ?? null,
      balanceAfter: tx.balance ?? null,
    };
  }

  /**
   * Refreshes run asynchronously upstream, so this only improves the NEXT
   * sync's freshness; the current sync reads the cached account as returned.
   */
  private async requestRefreshIfStale({
    apiClient,
    account,
  }: {
    apiClient: AkahuApiClient;
    account: AkahuApiAccount;
  }): Promise<void> {
    const lastRefresh = account.refreshed?.transactions ? new Date(account.refreshed.transactions).getTime() : 0;
    if (Date.now() - lastRefresh > STALE_DATA_THRESHOLD_MS) {
      await apiClient.requestRefresh({ accountId: account._id });
    }
  }

  private isValidCredentials(credentials: unknown): credentials is AkahuCredentials {
    if (typeof credentials !== 'object' || credentials === null) {
      return false;
    }
    const { userToken, appToken } = credentials as Record<string, unknown>;
    return typeof userToken === 'string' && userToken.length > 0 && typeof appToken === 'string' && appToken.length > 0;
  }

  private async getValidatedCredentials(connectionId: string): Promise<AkahuCredentials> {
    const credentials = await this.getDecryptedCredentials(connectionId);
    if (!this.isValidCredentials(credentials)) {
      throw new ValidationError({
        message: t({ key: 'bankDataProviders.akahu.invalidCredentialsFormat' }),
      });
    }
    return credentials;
  }
}

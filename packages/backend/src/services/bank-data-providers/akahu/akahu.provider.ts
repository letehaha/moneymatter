import type { Cents, RecordId } from '@bt/shared/types';
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ACCOUNT_TYPES,
  BANK_PROVIDER_TYPE,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  asCents,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { BadRequestError, ForbiddenError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import type Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { findOneTransaction } from '@models/transactions-query';
import { getUserDefaultCategory } from '@models/users.model';
import {
  BaseBankDataProvider,
  type DateRange,
  type LoadTransactionsForPeriodResult,
  type ProviderAccount,
  type ProviderBalance,
  type ProviderMetadata,
  type ProviderTransaction,
} from '@services/bank-data-providers';
import { createTransaction } from '@services/transactions';
import { accountHasPlannedRows } from '@services/transactions/planned-matching';
import { Op, Sequelize } from 'sequelize';

import { clampSyncStartToLink } from '../utils/clamp-sync-start-to-link';
import { encryptCredentials } from '../utils/credential-encryption';
import { notifyPlannedConfirmations } from '../utils/notify-planned-confirmations';
import { writeBankBalanceWithHistory } from '../utils/write-bank-balance-with-history';
import { AkahuApiClient } from './api-client';
import type {
  AkahuApiAccount,
  AkahuApiAccountsResponse,
  AkahuApiMe,
  AkahuApiTransaction,
  AkahuCredentials,
  AkahuMetadata,
} from './types';

/**
 * Personal-app data is refreshed by Akahu on a daily schedule. Only ask for an
 * on-demand refresh when the cached view is older than this; the manual-refresh
 * rest period is 1h and excessive refresh requests are an abuse vector, so at
 * most ~one request per day per connection.
 */
const STALE_DATA_THRESHOLD_MS = 20 * 60 * 60 * 1000;

/**
 * The incremental fetch window overlaps the newest stored transaction by this
 * much. Akahu transaction dates are typically day-precise (`T00:00:00Z`), and
 * `start` is exclusive on that instant — without the overlap, transactions
 * posted later the same day as the newest stored row would be skipped forever.
 * Dedup by `originalId` absorbs the refetched rows.
 */
const INCREMENTAL_OVERLAP_MS = 24 * 60 * 60 * 1000;

interface PersisterCounters {
  createdTransactionIds: string[];
  mergedIntoPlannedCount: number;
  skippedPreLinkCount: number;
}

/**
 * Akahu provider implementation
 * Syncs NZ bank accounts connected through an Akahu personal app
 * (free, single-user, two static tokens — no OAuth dance).
 *
 * Docs: https://developers.akahu.nz/docs/personal-apps
 */
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

  // ============================================================================
  // Connection Management
  // ============================================================================

  async connect(userId: number, credentials: unknown): Promise<string> {
    if (!this.isValidCredentials(credentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.akahu.invalidCredentialsFormat' }) });
    }

    const apiClient = new AkahuApiClient(credentials);

    // Validate via /me and capture the consent date: Akahu only serves
    // transactions from `access_granted_at` back 730 days for personal apps.
    // Network/5xx errors propagate so callers can distinguish "bad tokens"
    // from "Akahu is down".
    let me: AkahuApiMe;
    try {
      me = await apiClient.getMe();
    } catch (error) {
      if (error instanceof ForbiddenError) {
        throw new ForbiddenError({ message: t({ key: 'bankDataProviders.akahu.invalidTokens' }) });
      }
      throw error;
    }

    const accountsResponse: AkahuApiAccountsResponse = await apiClient.getAccounts();

    const existingConnections = await BankDataProviderConnections.count({
      where: { userId, providerType: this.metadata.type },
    });
    const providerName = existingConnections > 0 ? `Akahu (${existingConnections + 1})` : 'Akahu';

    const connection = await BankDataProviderConnections.create({
      userId,
      providerType: this.metadata.type,
      providerName,
      isActive: true,
      credentials: encryptCredentials({ userToken: credentials.userToken, appToken: credentials.appToken }),
      metadata: {
        accountCount: accountsResponse.items.length,
        accessGrantedAt: me.item.access_granted_at ?? null,
        consecutiveAuthFailures: 0,
        deactivationReason: null,
      } as AkahuMetadata,
    } as any);

    return connection.id;
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    // Personal apps are user-created and shared across connections; there is
    // nothing server-side to revoke.
    await connection.destroy();
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

    const apiClient = new AkahuApiClient(newCredentials);
    const isValid = await apiClient.testConnection();
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.akahu.invalidTokens' }) });
    }

    connection.setEncryptedCredentials({
      userToken: newCredentials.userToken,
      appToken: newCredentials.appToken,
    });

    // New object reference: mutating metadata in place leaves the JSONB column clean and the reset is never saved.
    const metadata: AkahuMetadata = { ...(connection.metadata as AkahuMetadata) };
    metadata.consecutiveAuthFailures = 0;
    metadata.deactivationReason = null;
    connection.metadata = metadata;
    connection.isActive = true;

    await connection.save();
  }

  // ============================================================================
  // Account Operations
  // ============================================================================

  async fetchAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const credentials = await this.getValidatedCredentials(connectionId);
    const apiClient = new AkahuApiClient(credentials);

    let accountsResponse: AkahuApiAccountsResponse;
    try {
      accountsResponse = await apiClient.getAccounts();
      await this.resetAuthFailures(connectionId);
    } catch (error) {
      await this.handleAuthError({ connectionId, error });
      throw error;
    }

    return accountsResponse.items
      .filter((account) => account.status === 'ACTIVE' && (account.attributes || []).includes('TRANSACTIONS'))
      .map((account) => this.toProviderAccount(account))
      .filter((account): account is ProviderAccount => account !== null);
  }

  private toProviderAccount(account: AkahuApiAccount): ProviderAccount | null {
    const currency = (account.balance?.currency || '').toUpperCase();
    if (!currency) {
      logger.error({
        message: `[Akahu] Skipping account ${account._id} (${account.name}): no currency in balance payload`,
      });
      return null;
    }

    const balance: Cents =
      account.balance?.current == null ? asCents(0) : Money.fromDecimal(account.balance.current).toCents();

    return {
      externalId: account._id,
      name: account.name,
      type: 'bank' as const,
      balance,
      currency,
      metadata: {
        institutionName: account.connection?.name ?? null,
        institutionLogo: account.connection?.logo ?? null,
        akahuType: account.type,
        accountNumber: account.formatted_account ?? null,
        holder: account.meta?.holder ?? null,
        status: account.status,
      },
    };
  }

  // ============================================================================
  // Transaction Operations
  // ============================================================================

  async fetchTransactions(
    connectionId: string,
    accountExternalId: string,
    dateRange?: DateRange,
  ): Promise<ProviderTransaction[]> {
    const credentials = await this.getValidatedCredentials(connectionId);
    const apiClient = new AkahuApiClient(credentials);

    // Transactions carry no currency field; the account's balance currency is authoritative.
    let account: AkahuApiAccount;
    let transactions: AkahuApiTransaction[];
    try {
      ({ item: account } = await apiClient.getAccount({ accountId: accountExternalId }));
      transactions = await apiClient.getTransactions({
        accountId: accountExternalId,
        start: dateRange?.from,
        end: dateRange?.to,
      });
      await this.resetAuthFailures(connectionId);
    } catch (error) {
      await this.handleAuthError({ connectionId, error });
      throw error;
    }
    const currency = (account.balance?.currency || '').toUpperCase();

    return transactions.map((tx) => ({
      externalId: tx._id,
      amount: Money.fromDecimal(tx.amount).toCents(),
      currency,
      date: new Date(tx.date),
      description: tx.description || tx.merchant?.name || '',
      merchantName: tx.merchant?.name,
      metadata: this.transactionMetadata(tx),
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

        // Returns the (possibly just-refresh-requested) account payload.
        const freshAccount = await this.refreshIfStale({
          connectionId,
          apiClient,
          accountExternalId: account.externalId,
        });

        // An account with nothing stored yet is a backfill: fetch everything
        // Akahu serves for a personal app (730 days). Otherwise fetch since the
        // newest stored transaction, with a same-day overlap because `start` is
        // exclusive on a typically day-precise date.
        const anyStoredTransaction = await findOneTransaction({
          planned: 'exclude',
          access: 'unscoped-internal',
          balanceAdjustments: 'include',
          where: { accountId: account.id, time: { [Op.lte]: new Date() } },
        });
        const start = anyStoredTransaction
          ? new Date(new Date(anyStoredTransaction.time).getTime() - INCREMENTAL_OVERLAP_MS)
          : undefined;

        const matchPlanned = Boolean(anyStoredTransaction) && (await accountHasPlannedRows({ accountId: account.id }));
        const createFromDate = anyStoredTransaction
          ? clampSyncStartToLink({ account, from: new Date(0) })
          : new Date(0);

        const persister = await this.createPersister({ connection, account, matchPlanned, createFromDate });

        let fetched: AkahuApiTransaction[];
        try {
          fetched = await apiClient.getTransactions({
            accountId: account.externalId,
            start,
            onBatch: persister.persist,
          });
          await this.resetAuthFailures(connectionId);
        } catch (error) {
          await this.handleAuthError({ connectionId, error });
          throw error;
        }

        const counters = persister.counters();
        if (
          counters.createdTransactionIds.length > 0 ||
          counters.mergedIntoPlannedCount > 0 ||
          counters.skippedPreLinkCount > 0
        ) {
          logger.info(
            `[Akahu] Sync: ${counters.createdTransactionIds.length} transactions created, ${counters.mergedIntoPlannedCount} planned confirmed, ${counters.skippedPreLinkCount} pre-link rows skipped for account ${account.id}`,
          );
          await notifyPlannedConfirmations({
            userId: connection.userId,
            accountId: account.id,
            mergedCount: counters.mergedIntoPlannedCount,
          });
        }

        // Update account balance — reuse the account payload we already fetched.
        if (freshAccount.balance?.current != null) {
          await writeBankBalanceWithHistory({ account, balance: Money.fromDecimal(freshAccount.balance.current) });
        }

        return { transactionIds: counters.createdTransactionIds, fetchedCount: fetched.length };
      },
    });
  }

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
  }): Promise<LoadTransactionsForPeriodResult> {
    const result = await this.runSyncWithStatus({
      systemAccountId,
      userId,
      connectionId,
      errorLogMessage: '[Akahu] Period load error:',
      work: async () => {
        const account = await this.getSystemAccount(systemAccountId);
        const connection = await this.getConnection(connectionId);
        this.validateProviderType(connection);

        if (!account.externalId) {
          throw new BadRequestError({ message: t({ key: 'bankDataProviders.akahu.accountNoExternalId' }) });
        }

        const credentials = await this.getValidatedCredentials(connectionId);
        const apiClient = new AkahuApiClient(credentials);

        let akahuAccount: AkahuApiAccount;
        try {
          ({ item: akahuAccount } = await apiClient.getAccount({ accountId: account.externalId }));
        } catch (error) {
          await this.handleAuthError({ connectionId, error });
          throw error;
        }

        // No `matchPlanned`: a charge from an arbitrary past window must not
        // consume a plan the user made for something else.
        const persister = await this.createPersister({
          connection,
          account,
          matchPlanned: false,
          createFromDate: clampSyncStartToLink({ account, from }),
        });

        let fetched: AkahuApiTransaction[];
        try {
          fetched = await apiClient.getTransactions({
            accountId: account.externalId,
            start: from,
            end: to,
            onBatch: persister.persist,
          });
          await this.resetAuthFailures(connectionId);
        } catch (error) {
          await this.handleAuthError({ connectionId, error });
          throw error;
        }
        const counters = persister.counters();

        if (counters.createdTransactionIds.length > 0 && akahuAccount.balance?.current != null) {
          await writeBankBalanceWithHistory({ account, balance: Money.fromDecimal(akahuAccount.balance.current) });
        }

        return { transactionIds: counters.createdTransactionIds, fetchedCount: fetched.length };
      },
    });

    return {
      jobGroupId: null,
      totalBatches: 1,
      estimatedMinutes: 0,
      createdCount: result.transactionIds.length,
      fetchedCount: result.fetchedCount,
    };
  }

  // ============================================================================
  // Balance Operations
  // ============================================================================

  async fetchBalance(connectionId: string, accountExternalId: string): Promise<ProviderBalance> {
    const credentials = await this.getValidatedCredentials(connectionId);
    const apiClient = new AkahuApiClient(credentials);
    let account: AkahuApiAccount;
    try {
      ({ item: account } = await apiClient.getAccount({ accountId: accountExternalId }));
      await this.resetAuthFailures(connectionId);
    } catch (error) {
      await this.handleAuthError({ connectionId, error });
      throw error;
    }

    return {
      amount: account.balance?.current == null ? asCents(0) : Money.fromDecimal(account.balance.current).toCents(),
      currency: (account.balance?.currency || '').toUpperCase(),
      asOf: account.refreshed?.balance ? new Date(account.refreshed.balance) : new Date(),
    };
  }

  async refreshBalance(connectionId: string, systemAccountId: string): Promise<void> {
    const account = await this.getSystemAccount(systemAccountId);

    if (!account.externalId) {
      throw new BadRequestError({ message: t({ key: 'bankDataProviders.akahu.accountNoExternalId' }) });
    }

    const balance = await this.fetchBalance(connectionId, account.externalId);
    await writeBankBalanceWithHistory({ account, balance: Money.fromCents(balance.amount) });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Shared row-persistence loop for sync and period load. Dedup mirrors the
   * two-tier scheme used by LunchFlow/Walutomat/SimpleFIN: primary by
   * `originalId`, secondary by `externalData.originalSource.originalId`
   * (covers unlink→relink, restoring `originalId` on a hit).
   */
  private async createPersister({
    connection,
    account,
    matchPlanned,
    createFromDate,
  }: {
    connection: BankDataProviderConnections;
    account: Accounts;
    matchPlanned: boolean;
    createFromDate: Date;
  }): Promise<{ persist: (transactions: AkahuApiTransaction[]) => Promise<void>; counters: () => PersisterCounters }> {
    const defaultCategoryId = await getUserDefaultCategory({ id: connection.userId });
    const createdTransactionIds: string[] = [];
    let mergedIntoPlannedCount = 0;
    let skippedPreLinkCount = 0;
    const checkpoint = this.createBaseCurrencyLockCheckpoint({ userId: connection.userId });

    const persist = async (transactions: AkahuApiTransaction[]): Promise<void> => {
      // Persist in ledger order so planned-merge sees transactions ascending.
      const ascending = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      for (const tx of ascending) {
        await checkpoint();

        const existingTx = await findOneTransaction({
          planned: 'exclude',
          access: 'unscoped-internal',
          balanceAdjustments: 'include',
          where: { accountId: account.id, originalId: tx._id },
          paranoid: false,
        });

        if (existingTx) {
          continue;
        }

        const existingByOriginalSource = await findOneTransaction({
          planned: 'exclude',
          access: 'unscoped-internal',
          balanceAdjustments: 'include',
          where: Sequelize.and(
            { accountId: account.id, originalId: null },
            Sequelize.where(Sequelize.literal(`"externalData"#>>'{originalSource,originalId}'`), tx._id),
          ),
          paranoid: false,
        });

        if (existingByOriginalSource) {
          // Restore the originalId so future syncs use the fast primary path
          await existingByOriginalSource.update({ originalId: tx._id });
          continue;
        }

        // Never create rows before the link date: that history is already absorbed into the opening balance.
        if (new Date(tx.date) < createFromDate) {
          skippedPreLinkCount += 1;
          continue;
        }

        const isExpense = tx.amount < 0;

        const createResult = await createTransaction({
          originalId: tx._id,
          note: tx.description || tx.merchant?.name || '',
          amount: Money.fromDecimal(Math.abs(tx.amount)),
          time: new Date(tx.date),
          externalData: this.transactionMetadata(tx),
          commissionRate: Money.fromCents(0),
          cashbackAmount: Money.fromCents(0),
          accountId: account.id,
          userId: connection.userId,
          transactionType: isExpense ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
          categoryId: defaultCategoryId,
          transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
          accountType: ACCOUNT_TYPES.akahu,
          rawMerchantName: tx.merchant?.name?.trim() || null,
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
    };

    return {
      persist,
      counters: () => ({ createdTransactionIds, mergedIntoPlannedCount, skippedPreLinkCount }),
    };
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
   * Ask Akahu for fresh bank data when its cached view is stale, so a sync
   * started right after a purchase eventually sees it. Refreshes run
   * asynchronously upstream: this call improves the NEXT sync's freshness,
   * never the current one's. All refresh failures are swallowed inside
   * requestRefresh; only the account read can throw (auth → tracked).
   */
  private async refreshIfStale({
    connectionId,
    apiClient,
    accountExternalId,
  }: {
    connectionId: string;
    apiClient: AkahuApiClient;
    accountExternalId: string;
  }): Promise<AkahuApiAccount> {
    try {
      const { item: account } = await apiClient.getAccount({ accountId: accountExternalId });
      await this.resetAuthFailures(connectionId);
      const lastRefresh = account.refreshed?.transactions ? new Date(account.refreshed.transactions).getTime() : 0;

      if (Date.now() - lastRefresh > STALE_DATA_THRESHOLD_MS) {
        await apiClient.requestRefresh();
        // Re-read so the caller can reuse the payload.
        return (await apiClient.getAccount({ accountId: accountExternalId })).item;
      }

      return account;
    } catch (error) {
      await this.handleAuthError({ connectionId, error });
      throw error;
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

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ACCOUNT_TYPES,
  BANK_PROVIDER_TYPE,
  type Cents,
  type RecordId,
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
        consecutiveAuthFailures: 0,
        deactivationReason: null,
      } satisfies AkahuMetadata,
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

    const isValid = await this.validateCredentials(newCredentials);
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.akahu.invalidTokens' }) });
    }

    connection.setEncryptedCredentials({
      userToken: newCredentials.userToken,
      appToken: newCredentials.appToken,
    });

    // New object reference: mutating metadata in place leaves the JSONB column clean and the reset is never saved.
    connection.metadata = {
      ...(connection.metadata as AkahuMetadata),
      consecutiveAuthFailures: 0,
      deactivationReason: null,
    } satisfies AkahuMetadata;
    connection.isActive = true;

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
      balance: this.balanceCents(account),
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

  async fetchTransactions(
    connectionId: string,
    accountExternalId: string,
    dateRange?: DateRange,
  ): Promise<ProviderTransaction[]> {
    const credentials = await this.getValidatedCredentials(connectionId);
    const apiClient = new AkahuApiClient(credentials);

    // Transactions carry no currency field; the account's balance currency is authoritative.
    const { account, transactions } = await this.withAuthTracking({
      connectionId,
      request: async () => ({
        account: (await apiClient.getAccount({ accountId: accountExternalId })).item,
        transactions: await apiClient.getTransactions({
          accountId: accountExternalId,
          start: dateRange?.from,
          end: dateRange?.to,
        }),
      }),
    });
    const currency = this.currencyOf(account);

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

        // An account with nothing stored yet is a backfill: fetch everything
        // Akahu serves for a personal app (730 days) and don't consume plans.
        const anyStoredTransaction = await findOneTransaction({
          planned: 'exclude',
          access: 'unscoped-internal',
          balanceAdjustments: 'include',
          where: { accountId: account.id, time: { [Op.lte]: new Date() } },
        });
        const newestImported =
          anyStoredTransaction &&
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

        const matchPlanned = Boolean(anyStoredTransaction) && (await accountHasPlannedRows({ accountId: account.id }));
        const counters = await this.persistTransactions({
          connection,
          account,
          transactions: fetched,
          matchPlanned,
          createFromDate: anyStoredTransaction ? clampSyncStartToLink({ account, from: new Date(0) }) : new Date(0),
        });

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

        if (akahuAccount.balance.current != null) {
          await writeBankBalanceWithHistory({ account, balance: Money.fromDecimal(akahuAccount.balance.current) });
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

        const externalId = account.externalId;
        const { akahuAccount, fetched } = await this.withAuthTracking({
          connectionId,
          request: async () => ({
            akahuAccount: (await apiClient.getAccount({ accountId: externalId })).item,
            // `start` is exclusive and dates are day-precise, so step back 1ms to keep rows dated exactly `from`.
            fetched: await apiClient.getTransactions({
              accountId: externalId,
              start: new Date(from.getTime() - 1),
              end: to,
            }),
          }),
        });

        // No `matchPlanned`: a charge from an arbitrary past window must not
        // consume a plan the user made for something else.
        const counters = await this.persistTransactions({
          connection,
          account,
          transactions: fetched,
          matchPlanned: false,
          createFromDate: clampSyncStartToLink({ account, from }),
        });

        if (counters.createdTransactionIds.length > 0 && akahuAccount.balance.current != null) {
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

  async fetchBalance(connectionId: string, accountExternalId: string): Promise<ProviderBalance> {
    const credentials = await this.getValidatedCredentials(connectionId);
    const apiClient = new AkahuApiClient(credentials);
    const { item: account } = await this.withAuthTracking({
      connectionId,
      request: () => apiClient.getAccount({ accountId: accountExternalId }),
    });

    return {
      amount: this.balanceCents(account),
      currency: this.currencyOf(account),
      asOf: account.refreshed?.balance ? new Date(account.refreshed.balance) : new Date(),
    };
  }

  async refreshBalance(connectionId: string, systemAccountId: string): Promise<void> {
    const account = await this.getSystemAccount(systemAccountId);

    if (!account.externalId) {
      throw new BadRequestError({ message: t({ key: 'bankDataProviders.akahu.accountNoExternalId' }) });
    }

    const credentials = await this.getValidatedCredentials(connectionId);
    const apiClient = new AkahuApiClient(credentials);
    const externalId = account.externalId;
    const { item } = await this.withAuthTracking({
      connectionId,
      request: () => apiClient.getAccount({ accountId: externalId }),
    });

    if (item.balance.current == null) {
      logger.info(`[Akahu] Account ${item._id} has no current balance, balance left unchanged`);
      return;
    }

    await writeBankBalanceWithHistory({ account, balance: Money.fromDecimal(item.balance.current) });
  }

  /**
   * Dedup is two-tier: primary by `originalId`, secondary by
   * `externalData.originalSource.originalId` (covers unlink→relink, restoring `originalId` on a hit).
   */
  private async persistTransactions({
    connection,
    account,
    transactions,
    matchPlanned,
    createFromDate,
  }: {
    connection: BankDataProviderConnections;
    account: Accounts;
    transactions: AkahuApiTransaction[];
    matchPlanned: boolean;
    createFromDate: Date;
  }) {
    const defaultCategoryId = await getUserDefaultCategory({ id: connection.userId });
    const createdTransactionIds: string[] = [];
    let mergedIntoPlannedCount = 0;
    let skippedPreLinkCount = 0;
    const checkpoint = this.createBaseCurrencyLockCheckpoint({ userId: connection.userId });

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
        await existingByOriginalSource.update({ originalId: tx._id });
        continue;
      }

      // Never create rows before the link date: that history is already absorbed into the opening balance.
      if (new Date(tx.date) < createFromDate) {
        skippedPreLinkCount += 1;
        continue;
      }

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
        transactionType: tx.amount < 0 ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
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

    return { createdTransactionIds, mergedIntoPlannedCount, skippedPreLinkCount };
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

  private currencyOf(account: AkahuApiAccount): string {
    if (!account.balance.currency) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.akahu.missingCurrency' }) });
    }
    return account.balance.currency.toUpperCase();
  }

  private balanceCents(account: AkahuApiAccount): Cents {
    if (account.balance.current == null) {
      logger.info(`[Akahu] Account ${account._id} has no current balance, defaulting to 0`);
      return asCents(0);
    }
    return Money.fromDecimal(account.balance.current).toCents();
  }

  private async withAuthTracking<T>({
    connectionId,
    request,
  }: {
    connectionId: string;
    request: () => Promise<T>;
  }): Promise<T> {
    try {
      const result = await request();
      await this.resetAuthFailures(connectionId);
      return result;
    } catch (error) {
      await this.handleAuthError({ connectionId, error });
      throw error;
    }
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

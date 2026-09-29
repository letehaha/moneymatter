import type { RecordId } from '@bt/shared/types';
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ACCOUNT_TYPES,
  BANK_PROVIDER_TYPE,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { BadRequestError, ForbiddenError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { findOneTransaction, findTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
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
import { linkTransactions } from '@services/transactions/transactions-linking/link-transactions';
import { Op, Sequelize } from 'sequelize';

import { encryptCredentials } from '../utils/credential-encryption';
import { notifyPlannedConfirmations } from '../utils/notify-planned-confirmations';
import { writeBankBalanceWithHistory } from '../utils/write-bank-balance-with-history';
import { type HistoryItem, type WalletBalance, WalutomatApiClient, WalutomatHttpError } from './api-client';
import { linkCrossProviderTransfers } from './cross-provider-linking';
import { WalutomatCredentials, WalutomatMetadata } from './types';

const WALLET_EXTERNAL_ID_PREFIX = 'wallet-';
const DEFAULT_SYNC_MONTHS = 12;

/**
 * Extract currency code from wallet externalId.
 * e.g. "wallet-eur" → "EUR"
 */
function currencyFromExternalId(externalId: string): string {
  return externalId.replace(WALLET_EXTERNAL_ID_PREFIX, '').toUpperCase();
}

/**
 * Build a wallet externalId from currency code.
 * e.g. "EUR" → "wallet-eur"
 */
function externalIdFromCurrency(currency: string): string {
  return `${WALLET_EXTERNAL_ID_PREFIX}${currency.toLowerCase()}`;
}

const detail = ({ item, key }: { item: HistoryItem; key: string }) =>
  item.operationDetails
    .find((d) => d.key === key)
    ?.value?.trim()
    .slice(0, 255) || undefined;

/**
 * Build a human-readable description from a Walutomat history item.
 */
function buildTransactionDescription(item: HistoryItem): string {
  const detailMap = new Map(item.operationDetails.map((d) => [d.key, d.value]));

  const parts: string[] = [];

  const title = detailMap.get('title');
  if (title) {
    parts.push(title);
  }

  const recipientName = detailMap.get('recipientName');
  if (recipientName) {
    parts.push(recipientName);
  }

  const currencyPair = detailMap.get('currencyPair');
  const rate = detailMap.get('rate');
  if (currencyPair) {
    const rateStr = rate ? ` @ ${rate}` : '';
    parts.push(`${currencyPair}${rateStr}`);
  }

  if (parts.length > 0) {
    return parts.join(' — ');
  }

  // Fallback: humanize the operationDetailedType
  return item.operationDetailedType.replace(/_/g, ' ').toLowerCase();
}

/**
 * Walutomat provider implementation.
 * Handles integration with Walutomat currency exchange platform.
 */
export class WalutomatProvider extends BaseBankDataProvider {
  readonly metadata: ProviderMetadata = {
    type: BANK_PROVIDER_TYPE.WALUTOMAT,
    name: 'Walutomat',
    description: 'Polish currency exchange platform with 23 currencies',
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
      throw new ValidationError({
        message: t({ key: 'bankDataProviders.walutomat.invalidCredentialsFormat' }),
      });
    }

    const isValid = await this.validateCredentials(credentials);
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.walutomat.invalidApiKey' }) });
    }

    const client = this.createApiClient(credentials);
    const balances = await client.getBalances();

    const existingConnections = await BankDataProviderConnections.count({
      where: { userId, providerType: this.metadata.type },
    });
    const providerName = existingConnections > 0 ? `Walutomat (${existingConnections + 1})` : 'Walutomat';

    const connection = await BankDataProviderConnections.create({
      userId,
      providerType: this.metadata.type,
      providerName,
      isActive: true,
      credentials: encryptCredentials({
        apiKey: credentials.apiKey,
        privateKey: credentials.privateKey,
      }),
      metadata: {
        walletCount: balances.length,
        consecutiveAuthFailures: 0,
        deactivationReason: null,
      } as WalutomatMetadata,
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

    const client = this.createApiClient(credentials);

    // testConnection returns false only for 401/403 or signing errors (bad private key).
    // Network/5xx errors propagate so callers can distinguish "invalid creds"
    // from "provider is down".
    return await client.testConnection();
  }

  async refreshCredentials(connectionId: string, newCredentials: unknown): Promise<void> {
    if (!this.isValidCredentials(newCredentials)) {
      throw new ValidationError({
        message: t({ key: 'bankDataProviders.walutomat.invalidCredentialsFormat' }),
      });
    }

    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    const isValid = await this.validateCredentials(newCredentials);
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.walutomat.invalidApiKey' }) });
    }

    connection.setEncryptedCredentials({
      apiKey: newCredentials.apiKey,
      privateKey: newCredentials.privateKey,
    });

    const metadata = (connection.metadata as WalutomatMetadata) || {};
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
    const credentials = await this.getValidatedCredentials(connectionId);

    let balances: WalletBalance[];
    try {
      const client = this.createApiClient(credentials);
      balances = await client.getBalances();
      await this.resetAuthFailures(connectionId);
    } catch (error) {
      await this.handleAuthError({ connectionId, error });
      throw error;
    }

    return balances.map((wallet) => ({
      externalId: externalIdFromCurrency(wallet.currency),
      name: `${wallet.currency} Wallet`,
      type: 'bank' as const,
      balance: Money.fromDecimal(parseFloat(wallet.balanceAvailable)).toCents(),
      currency: wallet.currency,
      metadata: {
        balanceTotal: wallet.balanceTotal,
        balanceAvailable: wallet.balanceAvailable,
        balanceReserved: wallet.balanceReserved,
      },
    }));
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
    const client = this.createApiClient(credentials);
    const currency = currencyFromExternalId(accountExternalId);

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setMonth(defaultFrom.getMonth() - DEFAULT_SYNC_MONTHS);

    const transactions: ProviderTransaction[] = [];

    for await (const item of client.getHistoryIterator({
      currencies: [currency],
      dateFrom: (dateRange?.from ?? defaultFrom).toISOString(),
      dateTo: (dateRange?.to ?? now).toISOString(),
      itemLimit: 200,
      sortOrder: 'ASC',
    })) {
      transactions.push({
        externalId: item.transactionId,
        amount: Money.fromDecimal(Math.abs(parseFloat(item.operationAmount))).toCents(),
        currency: item.currency,
        date: new Date(item.ts),
        description: buildTransactionDescription(item),
        metadata: {
          historyItemId: item.historyItemId,
          transactionId: item.transactionId,
          operationType: item.operationType,
          operationDetailedType: item.operationDetailedType,
          operationDetails: item.operationDetails,
          balanceAfter: item.balanceAfter,
        },
      });
    }

    return transactions;
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
      errorLogMessage: '[Walutomat] Sync error:',
      work: async () => {
        const account = await this.getSystemAccount(systemAccountId);
        const connection = await this.getConnection(connectionId);
        this.validateProviderType(connection);

        if (!account.externalId) {
          throw new BadRequestError({ message: t({ key: 'bankDataProviders.walutomat.accountNoExternalId' }) });
        }

        const credentials = await this.getValidatedCredentials(connectionId);
        const client = this.createApiClient(credentials);
        const currency = currencyFromExternalId(account.externalId);

        // Determine sync start date
        const latestTransaction = await findOneTransaction({
          planned: 'exclude',
          access: 'unscoped-internal',
          balanceAdjustments: 'include',
          where: { accountId: account.id },
          order: [['time', 'DESC']],
        });

        const now = new Date();
        let fromDate: Date;
        if (latestTransaction) {
          fromDate = new Date(latestTransaction.time);
        } else {
          fromDate = new Date(now);
          fromDate.setMonth(fromDate.getMonth() - DEFAULT_SYNC_MONTHS);
        }

        const historyItems: HistoryItem[] = [];
        try {
          for await (const item of client.getHistoryIterator({
            currencies: [currency],
            dateFrom: fromDate.toISOString(),
            dateTo: now.toISOString(),
            itemLimit: 200,
            sortOrder: 'ASC',
          })) {
            historyItems.push(item);
          }
          await this.resetAuthFailures(connectionId);
        } catch (error) {
          await this.handleAuthError({ connectionId, error });
          throw error;
        }

        const defaultCategoryId = await getUserDefaultCategory({ id: connection.userId });
        const createdTransactionIds: string[] = [];
        let mergedIntoPlannedCount = 0;
        const checkpoint = this.createBaseCurrencyLockCheckpoint({ userId });

        // One probe per run instead of one per row. Anchorless runs are backfills
        // and must not consume plans.
        const matchPlanned = Boolean(latestTransaction) && (await accountHasPlannedRows({ accountId: account.id }));

        for (const item of historyItems) {
          await checkpoint();

          // Primary dedup: check by originalId
          const existingTx = await findOneTransaction({
            planned: 'exclude',
            access: 'unscoped-internal',
            balanceAdjustments: 'include',
            where: {
              accountId: account.id,
              originalId: item.transactionId,
            },
            paranoid: false,
          });

          if (existingTx) {
            continue;
          }

          // Secondary dedup: check externalData.originalSource.originalId
          // Covers the unlink→relink flow where originalId was cleared
          const existingByOriginalSource = await findOneTransaction({
            planned: 'exclude',
            access: 'unscoped-internal',
            balanceAdjustments: 'include',
            where: Sequelize.and(
              { accountId: account.id, originalId: null },
              Sequelize.where(Sequelize.literal(`"externalData"#>>'{originalSource,originalId}'`), item.transactionId),
            ),
            paranoid: false,
          });

          if (existingByOriginalSource) {
            await existingByOriginalSource.update({ originalId: item.transactionId });
            continue;
          }

          const operationAmount = parseFloat(item.operationAmount);
          const isExpense = operationAmount < 0;

          const createResult = await createTransaction({
            originalId: item.transactionId,
            note: buildTransactionDescription(item),
            externalReference:
              detail({ item, key: 'partnerOrderId' }) ?? detail({ item, key: 'providerOperationId' }) ?? null,
            amount: Money.fromDecimal(Math.abs(operationAmount)),
            time: new Date(item.ts),
            externalData: {
              historyItemId: item.historyItemId,
              transactionId: item.transactionId,
              operationType: item.operationType,
              operationDetailedType: item.operationDetailedType,
              operationDetails: item.operationDetails,
              balanceAfter: item.balanceAfter,
            },
            commissionRate: Money.fromCents(0),
            cashbackAmount: Money.fromCents(0),
            accountId: account.id,
            userId: connection.userId,
            transactionType: isExpense ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
            paymentType: PAYMENT_TYPES.bankTransfer,
            categoryId: defaultCategoryId,
            transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
            accountType: ACCOUNT_TYPES.walutomat,
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

        if (createdTransactionIds.length > 0 || mergedIntoPlannedCount > 0) {
          logger.info(
            `[Walutomat] Sync: ${createdTransactionIds.length} transactions created, ${mergedIntoPlannedCount} planned confirmed for account ${account.id}`,
          );
          await notifyPlannedConfirmations({
            userId: connection.userId,
            accountId: account.id,
            mergedCount: mergedIntoPlannedCount,
          });
        }

        // Update account balance
        try {
          const balances = await client.getBalances();
          const wallet = balances.find((b) => b.currency === currency);
          if (wallet) {
            const balanceMoney = Money.fromDecimal(parseFloat(wallet.balanceAvailable));
            await writeBankBalanceWithHistory({ account, balance: balanceMoney });
          }
        } catch (error) {
          // Info-only: transactions are already synced; next sync retries the balance.
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.info(`[Walutomat] Failed to update balance for account ${account.id}: ${errorMsg}`);
        }

        return { transactionIds: createdTransactionIds };
      },
    });

    await this.linkFxTransfers({ userId });

    try {
      await linkCrossProviderTransfers({ userId });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`[Walutomat] Failed to auto-link cross-provider transfers: ${errorMsg}`);
    }
  }

  // ============================================================================
  // Balance Operations
  // ============================================================================

  async fetchBalance(connectionId: string, accountExternalId: string): Promise<ProviderBalance> {
    const credentials = await this.getValidatedCredentials(connectionId);
    const client = this.createApiClient(credentials);
    const currency = currencyFromExternalId(accountExternalId);

    const balances = await client.getBalances();
    const wallet = balances.find((b) => b.currency === currency);

    if (!wallet) {
      throw new BadRequestError({
        message: t({ key: 'bankDataProviders.walutomat.walletNotFound', variables: { currency } }),
      });
    }

    return {
      amount: Money.fromDecimal(parseFloat(wallet.balanceAvailable)).toCents(),
      currency: wallet.currency,
      asOf: new Date(),
    };
  }

  async refreshBalance(connectionId: string, systemAccountId: string): Promise<void> {
    const account = await this.getSystemAccount(systemAccountId);

    if (!account.externalId) {
      throw new BadRequestError({ message: t({ key: 'bankDataProviders.walutomat.accountNoExternalId' }) });
    }

    const balance = await this.fetchBalance(connectionId, account.externalId);

    await writeBankBalanceWithHistory({ account, balance: Money.fromCents(balance.amount) });
  }

  // Walutomat surfaces 401/403 via its own HTTP error class as well as
  // ForbiddenError, so widen the base detection.
  protected override isAuthError(error: unknown): boolean {
    return (
      super.isAuthError(error) ||
      (error instanceof WalutomatHttpError && (error.statusCode === 401 || error.statusCode === 403))
    );
  }

  // ============================================================================
  // FX Transfer Auto-Linking
  // ============================================================================

  /**
   * Auto-link MARKET_FX and DIRECT_FX transactions as transfers.
   *
   * FX trades in Walutomat create two history entries with the SAME transactionId
   * (used as originalId) — one income in the bought currency wallet and one expense
   * in the sold currency wallet. This method finds unlinked pairs and links them
   * as transfers using the existing linkTransactions service.
   */
  private async linkFxTransfers({ userId }: { userId: number }): Promise<void> {
    try {
      // Find all unlinked MARKET_FX and DIRECT_FX walutomat transactions for this user
      const unlinkedFxTxs = await findTransactions({
        planned: 'exclude',
        access: { creator: userId },
        balanceAdjustments: 'include',
        transfers: 'exclude',
        completeness: 'all',
        where: {
          accountType: ACCOUNT_TYPES.walutomat,
          originalId: { [Op.not]: null },
          [Op.or]: [
            Sequelize.where(Sequelize.literal(`"externalData"->>'operationType'`), 'MARKET_FX'),
            Sequelize.where(Sequelize.literal(`"externalData"->>'operationType'`), 'DIRECT_FX'),
          ],
        },
      });

      if (unlinkedFxTxs.length === 0) return;

      // Group by originalId to find matching pairs
      const groups = new Map<string, Transactions[]>();
      for (const tx of unlinkedFxTxs) {
        if (!tx.originalId) continue;
        const existing = groups.get(tx.originalId);
        if (existing) {
          existing.push(tx);
        } else {
          groups.set(tx.originalId, [tx]);
        }
      }

      // Collect valid pairs for linking
      const pairsToLink: [string, string][] = [];

      for (const [, txs] of groups) {
        // Only link complete pairs (exactly 2 transactions)
        if (txs.length !== 2) continue;

        const [a, b] = txs as [Transactions, Transactions];

        // Must be in different accounts with opposite transaction types
        if (a.accountId === b.accountId) continue;
        if (a.transactionType === b.transactionType) continue;

        // Determine which is the expense (base) and which is the income (opposite)
        const [baseTx, oppositeTx] = a.transactionType === TRANSACTION_TYPES.expense ? [a, b] : [b, a];

        pairsToLink.push([baseTx.id, oppositeTx.id]);
      }

      if (pairsToLink.length === 0) return;

      // One rejected pair (planned or split-bearing leg) must not abort the rest of the batch.
      let linkedCount = 0;
      for (const pair of pairsToLink) {
        try {
          await linkTransactions({ userId, ids: [pair] });
          linkedCount += 1;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.warn(`[Walutomat] Failed to auto-link FX pair ${pair[0]} <-> ${pair[1]}: ${errorMsg}`);
        }
      }

      if (linkedCount === 0) return;

      logger.info(`[Walutomat] Auto-linked ${linkedCount} FX transfer pair(s) for user ${userId}`);
    } catch (error) {
      // Non-critical — don't fail the sync if linking fails
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`[Walutomat] Failed to auto-link FX transfers: ${errorMsg}`);
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private createApiClient(credentials: WalutomatCredentials): WalutomatApiClient {
    return new WalutomatApiClient({
      apiKey: credentials.apiKey,
      privateKey: credentials.privateKey,
    });
  }

  private isValidCredentials(credentials: unknown): credentials is WalutomatCredentials {
    if (typeof credentials !== 'object' || credentials === null) {
      return false;
    }
    const creds = credentials as Record<string, unknown>;
    return (
      typeof creds.apiKey === 'string' &&
      creds.apiKey.length > 0 &&
      typeof creds.privateKey === 'string' &&
      creds.privateKey.length > 0
    );
  }

  private async getValidatedCredentials(connectionId: string): Promise<WalutomatCredentials> {
    const credentials = await this.getDecryptedCredentials(connectionId);
    if (!this.isValidCredentials(credentials)) {
      throw new ValidationError({
        message: t({ key: 'bankDataProviders.walutomat.invalidCredentialsFormat' }),
      });
    }
    return credentials;
  }
}

import type { RecordId } from '@bt/shared/types';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ACCOUNT_TYPES, BANK_PROVIDER_TYPE, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { BadRequestError, ForbiddenError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { findTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
import { BaseBankDataProvider, ProviderAccount, ProviderMetadata } from '@services/bank-data-providers';
import { linkTransactions } from '@services/transactions/transactions-linking/link-transactions';
import { Op, Sequelize } from 'sequelize';

import { PROVIDER_TO_ACCOUNT_TYPE } from '../types';
import { encryptCredentials } from '../utils/credential-encryption';
import { persistSyncedTransactions } from '../utils/persist-synced-transactions';
import { resolveSyncStart } from '../utils/resolve-sync-start';
import { writeBankBalanceWithHistory } from '../utils/write-bank-balance-with-history';
import { type HistoryItem, WalutomatApiClient, WalutomatHttpError } from './api-client';
import { linkCrossProviderTransfers } from './cross-provider-linking';
import { WalutomatCredentials, WalutomatMetadata } from './types';

const WALLET_EXTERNAL_ID_PREFIX = 'wallet-';
const BACKFILL_DAYS = 365;

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

    const client = new WalutomatApiClient(credentials);
    const balances = await client.getBalances();

    const providerName = await this.nextConnectionName({ userId, label: 'Walutomat' });

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

  async validateCredentials(credentials: unknown): Promise<boolean> {
    if (!this.isValidCredentials(credentials)) {
      return false;
    }

    const client = new WalutomatApiClient(credentials);

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

    this.reactivateConnection({ connection });

    await connection.save();
  }

  // ============================================================================
  // Account Operations
  // ============================================================================

  async fetchAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const credentials = await this.getValidatedCredentials(connectionId);

    const balances = await this.withAuthTracking({
      connectionId,
      request: () => new WalutomatApiClient(credentials).getBalances(),
    });

    return balances.map((wallet) => ({
      externalId: externalIdFromCurrency(wallet.currency),
      name: `${wallet.currency} Wallet`,
      type: 'bank' as const,
      balance: Money.fromDecimal(wallet.balanceAvailable),
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
        const client = new WalutomatApiClient(credentials);
        const currency = currencyFromExternalId(account.externalId);

        const now = new Date();
        const { from, matchPlanned } = await resolveSyncStart({ account, to: now, backfillDays: BACKFILL_DAYS });

        const historyItems = await this.withAuthTracking({
          connectionId,
          request: async () => {
            const items: HistoryItem[] = [];
            for await (const item of client.getHistoryIterator({
              currencies: [currency],
              dateFrom: from.toISOString(),
              dateTo: now.toISOString(),
              itemLimit: 200,
              sortOrder: 'ASC',
            })) {
              items.push(item);
            }
            return items;
          },
        });

        const { createdTransactionIds, mergedIntoPlannedCount } = await persistSyncedTransactions({
          account,
          userId: connection.userId,
          accountType: PROVIDER_TO_ACCOUNT_TYPE[this.metadata.type],
          checkpoint: this.createBaseCurrencyLockCheckpoint({ userId: connection.userId }),
          rows: historyItems.map((item) => ({
            originalId: item.transactionId,
            time: new Date(item.ts),
            amount: parseFloat(item.operationAmount),
            note: buildTransactionDescription(item),
            externalReference:
              detail({ item, key: 'partnerOrderId' }) ?? detail({ item, key: 'providerOperationId' }) ?? null,
            externalData: {
              historyItemId: item.historyItemId,
              transactionId: item.transactionId,
              operationType: item.operationType,
              operationDetailedType: item.operationDetailedType,
              operationDetails: item.operationDetails,
              balanceAfter: item.balanceAfter,
            },
          })),
          matchPlanned,
        });

        if (createdTransactionIds.length > 0 || mergedIntoPlannedCount > 0) {
          logger.info(
            `[Walutomat] Sync: ${createdTransactionIds.length} transactions created, ${mergedIntoPlannedCount} planned confirmed for account ${account.id}`,
          );
        }

        // Update account balance
        try {
          const balances = await client.getBalances();
          const wallet = balances.find((b) => b.currency === currency);
          if (wallet) {
            const balanceMoney = Money.fromDecimal(wallet.balanceAvailable);
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

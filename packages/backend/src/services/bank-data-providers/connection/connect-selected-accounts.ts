import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_STATUSES,
  API_ERROR_CODES,
  BANK_PROVIDER_TYPE,
  NO_CURRENCY_CODE,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { BadRequestError, NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import { type BankProvider, trackBankConnected } from '@js/utils/posthog';
import AccountGrouping from '@models/accounts-groups/account-grouping.model';
import AccountGroup from '@models/accounts-groups/account-groups.model';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { NON_CURRENCY_CODES, getCurrency } from '@models/currencies.model';
import Subscriptions from '@models/subscriptions.model';
import { calculateRefAmount } from '@root/services/calculate-ref-amount.service';
import { withTransaction } from '@root/services/common/with-transaction';
import {
  PROVIDER_TO_ACCOUNT_TYPE,
  restoreRelinkedTransactionsAccountType,
} from '@services/accounts/restore-relinked-transactions-account-type';
import { addUserCurrencies } from '@services/currencies/add-user-currency';

import { bankProviderRegistry } from '../registry';
import { enqueueAccountSync } from '../sync/account-sync-queue';
import type { AccountWithConnection } from '../sync/get-user-sync-status';

const PROVIDER_TO_ANALYTICS_TYPE: Record<BANK_PROVIDER_TYPE, BankProvider> = {
  [BANK_PROVIDER_TYPE.MONOBANK]: 'monobank',
  [BANK_PROVIDER_TYPE.ENABLE_BANKING]: 'enable_banking',
  [BANK_PROVIDER_TYPE.LUNCHFLOW]: 'lunchflow',
  [BANK_PROVIDER_TYPE.WALUTOMAT]: 'walutomat',
  [BANK_PROVIDER_TYPE.SIMPLEFIN]: 'simplefin',
};

/**
 * Rejects an external account already imported on another connection of the same provider:
 * both rows would pull the same feed and transaction dedup is per account.
 */
export const assertExternalAccountNotLinkedElsewhere = async ({
  userId,
  providerType,
  externalId,
}: {
  userId: number;
  providerType: BANK_PROVIDER_TYPE;
  externalId: string;
}): Promise<void> => {
  const alreadyLinked = (await Accounts.findOne({
    where: { userId, externalId },
    include: [
      {
        model: BankDataProviderConnections,
        as: 'bankDataProviderConnection',
        where: { providerType },
        required: true,
      },
    ],
  })) as AccountWithConnection | null;

  if (!alreadyLinked) return;

  throw new BadRequestError({
    message: t({
      key: 'bankDataProviders.accountAlreadyConnectedToAnotherConnection',
      variables: {
        account: alreadyLinked.name,
        connection: alreadyLinked.bankDataProviderConnection.providerName,
      },
    }),
  });
};

/**
 * Create accounts in the database within a transaction.
 * Returns created accounts so sync can happen after the transaction commits.
 */
const createAccountsForConnection = withTransaction(
  async ({
    connectionId,
    userId,
    accountExternalIds,
    currencyOverrides,
  }: {
    connectionId: string;
    userId: number;
    accountExternalIds: string[];
    /** externalId → currency the user picked for accounts the provider reported without one ("XXX"). */
    currencyOverrides?: Record<string, string>;
  }): Promise<Accounts[]> => {
    const connection = await BankDataProviderConnections.findOne({
      where: {
        id: connectionId,
        userId,
      },
    });

    if (!connection) {
      throw new NotFoundError({
        message: t({ key: 'errors.connectionNotFound' }),
        code: API_ERROR_CODES.notFound,
      });
    }

    const provider = bankProviderRegistry.get(connection.providerType as BANK_PROVIDER_TYPE);

    // Fetch all available accounts from provider
    const availableAccounts = await provider.fetchAccounts(connectionId);

    // Filter to only selected accounts
    const selectedAccounts = availableAccounts.filter((acc) => accountExternalIds.includes(acc.externalId));

    if (selectedAccounts.length === 0) {
      throw new BadRequestError({
        message: t({ key: 'bankDataProviders.noValidAccountIds' }),
      });
    }

    // Create accounts in database
    const createdAccounts: Accounts[] = [];
    for (const providerAccount of selectedAccounts) {
      // Check if account already exists (still linked to this connection)
      let existingAccount = await Accounts.findOne({
        where: {
          userId,
          externalId: providerAccount.externalId,
          bankDataProviderConnectionId: connectionId,
        },
      });

      // If not found, check for a previously-linked account (disconnected
      // accounts have their connection history stored in externalData after
      // unlinking). Match by providerType + externalId — NOT by the stored
      // connectionId, which is the OLD disconnected connection's id and will
      // never equal the new one after a fresh connect.
      if (!existingAccount) {
        existingAccount = await Accounts.findOne({
          where: {
            userId,
            bankDataProviderConnectionId: null,
            externalData: {
              connectionHistory: {
                previousConnection: {
                  externalId: providerAccount.externalId,
                  providerType: connection.providerType,
                },
              },
            },
          },
        });
      }

      if (existingAccount) {
        // Re-linking keeps the stored currency (currency is immutable), so a
        // currency override sent for this account is intentionally ignored.
        const override = currencyOverrides?.[providerAccount.externalId]?.toUpperCase();
        if (override && override !== existingAccount.currencyCode) {
          logger.warn(
            `[bank-data-providers] Discarding currency override "${override}" for re-linked account ` +
              `${providerAccount.externalId}: stored currency "${existingAccount.currencyCode}" is immutable.`,
          );
        }
        // Re-link and re-activate the account
        await existingAccount.update({
          status: ACCOUNT_STATUSES.active,
          type: PROVIDER_TO_ACCOUNT_TYPE[connection.providerType as BANK_PROVIDER_TYPE],
          bankDataProviderConnectionId: connectionId,
          externalId: providerAccount.externalId,
        });
        await Subscriptions.update(
          { autoRecord: false },
          { where: { accountId: existingAccount.id, autoRecord: true } },
        );
        await restoreRelinkedTransactionsAccountType({
          accountId: existingAccount.id,
          providerType: connection.providerType as BANK_PROVIDER_TYPE,
        });
        createdAccounts.push(existingAccount);
      } else {
        await assertExternalAccountNotLinkedElsewhere({
          userId,
          providerType: connection.providerType,
          externalId: providerAccount.externalId,
        });

        // ISO "XXX" means the provider could not determine the currency. The
        // user must pick one explicitly (recorded as currencyFallback so the
        // UI can explain the substitution). Currency is immutable afterwards —
        // deleting and reconnecting the account is the only way to change it.
        // Abolished alternative: silently assigning the user's base currency —
        // wrong for anyone whose base currency differs from the account's.
        let currencyFallback: { providerCurrency: string; assignedCurrency: string } | undefined;
        if (providerAccount.currency.toUpperCase() === NO_CURRENCY_CODE) {
          const override = currencyOverrides?.[providerAccount.externalId]?.toUpperCase();
          if (!override) {
            throw new ValidationError({
              message: t({
                key: 'bankDataProviders.currencySelectionRequired',
                variables: { account: providerAccount.name || providerAccount.externalId },
              }),
            });
          }
          currencyFallback = {
            providerCurrency: providerAccount.currency,
            assignedCurrency: override,
          };
          providerAccount.currency = override;
        }

        // Reject unknown codes and ISO 4217 non-currencies (metals, test codes):
        // they have no exchange rate, so calculateRefAmount below would throw a 500.
        const currency = await getCurrency({ code: providerAccount.currency.toUpperCase() });
        if (!currency || NON_CURRENCY_CODES.includes(currency.code)) {
          throw new BadRequestError({
            message: t({
              key: 'bankDataProviders.accountCurrencyNotSupported',
              variables: { currency: providerAccount.currency },
            }),
          });
        }
        await addUserCurrencies([{ userId, currencyCode: currency.code }]);

        const now = new Date();
        const accountRefBalance = await calculateRefAmount({
          amount: Money.fromCents(providerAccount.balance),
          userId,
          date: now,
          baseCode: providerAccount.currency,
        });

        const creditLimitCents = (providerAccount.metadata?.creditLimit as number) || 0;
        const refCreditLimit =
          creditLimitCents > 0
            ? await calculateRefAmount({
                amount: Money.fromCents(creditLimitCents),
                userId,
                date: now,
                baseCode: providerAccount.currency,
              })
            : Money.zero();

        // Create new account
        const accountName =
          providerAccount.name ||
          [providerAccount.metadata?.institutionName, providerAccount.currency].filter(Boolean).join(' ') ||
          providerAccount.externalId;

        const newAccount = await Accounts.create({
          userId,
          name: accountName,
          type: PROVIDER_TO_ACCOUNT_TYPE[connection.providerType as BANK_PROVIDER_TYPE],
          accountCategory: ACCOUNT_CATEGORIES.general,
          currencyCode: providerAccount.currency,
          initialBalance: providerAccount.balance,
          refInitialBalance: accountRefBalance,
          currentBalance: providerAccount.balance,
          refCurrentBalance: accountRefBalance,
          creditLimit: creditLimitCents,
          refCreditLimit,
          externalId: providerAccount.externalId,
          externalData: { ...(providerAccount.metadata || {}), ...(currencyFallback && { currencyFallback }) },
          bankDataProviderConnectionId: connectionId,
        });
        createdAccounts.push(newAccount);
      }
    }

    // Update connection's last sync timestamp
    await connection.update({ lastSyncAt: new Date() });

    // Track analytics event
    if (createdAccounts.length > 0) {
      trackBankConnected({
        userId,
        provider: PROVIDER_TO_ANALYTICS_TYPE[connection.providerType as BANK_PROVIDER_TYPE],
        accountsCount: createdAccounts.length,
      });
    }

    // Auto-create or find the AccountGroup for this bank connection,
    // then link ungrouped accounts to it
    if (createdAccounts.length > 0) {
      const [connectionGroup] = await AccountGroup.findOrCreate({
        where: { bankDataProviderConnectionId: connectionId, userId },
        defaults: { name: connection.providerName, userId, bankDataProviderConnectionId: connectionId },
      });

      for (const account of createdAccounts) {
        // Only add if the account is not already in any group
        const existingGrouping = await AccountGrouping.findOne({
          where: { accountId: account.id },
        });

        if (!existingGrouping) {
          await AccountGrouping.create({ accountId: account.id, groupId: connectionGroup.id });
        }
      }
    }

    return createdAccounts;
  },
);

/**
 * Connect selected external accounts and queue their initial transaction sync.
 * Account creation is transactional and the response returns as soon as it
 * commits. The sync itself runs on the `account-sync` BullMQ queue: a first
 * backfill can run for minutes and reverse proxies cut the request off with a
 * 504 after ~60s. Clients follow per-account sync status (QUEUED → SYNCING →
 * COMPLETED/FAILED) instead.
 */
export const connectSelectedAccounts = async ({
  connectionId,
  userId,
  accountExternalIds,
  currencyOverrides,
}: {
  connectionId: string;
  userId: number;
  accountExternalIds: string[];
  currencyOverrides?: Record<string, string>;
}): Promise<Accounts[]> => {
  const createdAccounts = await createAccountsForConnection({
    connectionId,
    userId,
    accountExternalIds,
    currencyOverrides,
  });

  const connection = await BankDataProviderConnections.findByPk(connectionId);

  // Logging post-commit keeps rolled-back link attempts from emitting phantom
  // account ids, and covers re-linked accounts, which keep their prior balance.
  for (const account of createdAccounts) {
    logger.info('[balance-diag] Bank account linked', {
      provider: connection?.providerType ?? null,
      connectionId,
      accountId: account.id,
      userId,
      accountType: account.type,
      currency: account.currencyCode,
      initialBalanceCents: account.initialBalance?.toCents() ?? null,
      currentBalanceCents: account.currentBalance?.toCents() ?? null,
      refCurrentBalanceCents: account.refCurrentBalance?.toCents() ?? null,
    });
  }

  if (!connection) {
    throw new NotFoundError({
      message: t({ key: 'errors.connectionNotFound' }),
      code: API_ERROR_CODES.notFound,
    });
  }

  await enqueueAccountSync({
    userId,
    connectionId: connection.id,
    providerType: connection.providerType,
    accountIds: createdAccounts.map((account) => account.id),
  });

  return createdAccounts;
};

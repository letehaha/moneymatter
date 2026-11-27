import {
  ACCOUNT_TYPES,
  API_ERROR_CODES,
  BANK_PROVIDER_TYPE,
  DEACTIVATION_REASON,
  type PlaidLinkTokenResponse,
  type RecordId,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ConflictError, ForbiddenError, NotAllowedError, ServiceUnavailableError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { connection as dbConnection, namespace } from '@models/connection';
import { lockLinkedBankAccount } from '@services/accounts/lock-account-row';
import { z } from 'zod';

import { AccountUnlinkedDuringSyncError, BaseBankDataProvider } from '../base-provider';
import type { AuthTrackingMetadata, ProviderAccount, ProviderMetadata } from '../types';
import { encryptCredentials } from '../utils/credential-encryption';
import { writeBankBalanceWithHistory } from '../utils/write-bank-balance-with-history';
import { PlaidApiClient, PlaidApiError, getPlaidConfig, plaidCredentialsSchema } from './api-client';
import { applyPlaidChanges } from './apply-transaction-changes';
import { normalizePlaidAccount } from './normalize';
import type { PlaidCredentials, PlaidMetadata } from './types';

const publicCredentialsSchema = z.strictObject({ publicToken: z.string().min(1).max(1024) });

const invalidCredentials = () =>
  new ForbiddenError({
    code: API_ERROR_CODES.invalidCredentials,
    message: t({ key: 'bankDataProviders.enableBanking.sessionExpiredReconnect' }),
  });
const providerUnavailable = () =>
  new ServiceUnavailableError({ message: t({ key: 'bankDataProviders.providerNotAvailable' }) });
const accountNotLinked = () =>
  new AccountUnlinkedDuringSyncError({ message: t({ key: 'bankDataProviders.accountNotLinkedToConnection' }) });

const invalidMapping = () =>
  new ConflictError({ message: t({ key: 'bankDataProviders.accountNotLinkedToConnection' }) });

const INVALID_TOKEN_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'ITEM_LOCKED',
  'USER_SETUP_REQUIRED',
  'INVALID_ACCESS_TOKEN',
  'ITEM_NOT_FOUND',
  'USER_PERMISSION_REVOKED',
  'INVALID_PUBLIC_TOKEN',
]);
const REQUEST_ERROR_TYPES = new Set(['INVALID_REQUEST', 'INVALID_INPUT']);
const NON_OUTAGE_CODES = new Set(['INVALID_API_KEYS', 'MALFORMED_RESPONSE']);

// Upstream error bodies stay out of HTTP responses and sync status; only the Plaid code is logged.
const requestPlaid = async <T>({
  request,
  connectionId,
}: {
  request: () => Promise<T>;
  connectionId?: string;
}): Promise<T> => {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof PlaidApiError)) throw error;
    logger.warn('[Plaid] Request failed', { status: error.status, code: error.code, type: error.type, connectionId });
    if (error.code && INVALID_TOKEN_CODES.has(error.code)) throw invalidCredentials();
    // A misconfigured instance, a malformed request or a response we can't parse is our bug, not an outage.
    if (NON_OUTAGE_CODES.has(error.code ?? '') || REQUEST_ERROR_TYPES.has(error.type ?? '')) {
      throw new Error('Plaid rejected the request', { cause: error });
    }
    throw providerUnavailable();
  }
};

const requirePlaid = () => {
  const config = getPlaidConfig();
  if (!config) throw new NotAllowedError({ message: t({ key: 'bankDataProviders.providerNotAvailable' }) });
  return new PlaidApiClient({ config });
};

const getPlaidConnection = ({ connectionId, lock = false }: { connectionId: string; lock?: boolean }) =>
  findOrThrowNotFound({
    query: BankDataProviderConnections.findOne({
      where: { id: connectionId, providerType: BANK_PROVIDER_TYPE.PLAID },
      lock: lock ? namespace.get('transaction').LOCK.NO_KEY_UPDATE : undefined,
    }),
    message: t({ key: 'errors.connectionNotFound' }),
  });

const isRestored = ({ connection }: { connection: BankDataProviderConnections }) =>
  (connection.metadata as AuthTrackingMetadata | null)?.deactivationReason === DEACTIVATION_REASON.RESTORED;

const requireCredentials = ({ connection }: { connection: BankDataProviderConnections }): PlaidCredentials => {
  if (isRestored({ connection })) throw invalidCredentials();
  try {
    return plaidCredentialsSchema.parse(connection.getDecryptedCredentials());
  } catch (error) {
    // The error can quote decrypted text, so only its name is logged and it is not kept as a cause.
    logger.error('[Plaid] Stored credentials could not be read', {
      connectionId: connection.id,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw new Error(t({ key: 'bankDataProviders.enableBanking.invalidStoredCredentials' }));
  }
};

const getAccounts = async ({ client, accessToken }: { client: PlaidApiClient; accessToken: string }) => {
  const accounts = await client.getAccounts({ accessToken });
  const result: ProviderAccount[] = [];
  for (const account of accounts) {
    const normalized = normalizePlaidAccount({ account });
    if (normalized) result.push(normalized);
  }
  return result;
};

const linkedAt = ({ account }: { account: Accounts }) => account.externalData?.bankConnection?.linkedAt ?? null;

const getCursor = ({ connection, account }: { connection: BankDataProviderConnections; account: Accounts }) => {
  const cursor = (connection.metadata as PlaidMetadata | null)?.plaidCursors?.[account.id];
  return cursor && cursor.externalId === account.externalId && cursor.linkedAt === linkedAt({ account })
    ? cursor.value
    : undefined;
};

export class PlaidProvider extends BaseBankDataProvider {
  readonly metadata: ProviderMetadata = {
    type: BANK_PROVIDER_TYPE.PLAID,
    name: 'Plaid',
    description: 'Read balances and posted transactions from institutions in the US and Canada.',
    features: {
      supportsWebhooks: false,
      supportsRealtime: false,
      requiresReauth: true,
      supportsManualSync: true,
      supportsAutoSync: true,
      defaultSyncInterval: 12 * 60 * 60 * 1000,
      minSyncInterval: 5 * 60 * 1000,
    },
  };

  async connect(userId: number, credentials: unknown): Promise<string> {
    return this.connectWithDetails({ userId, credentials });
  }

  async connectWithDetails({
    userId,
    credentials,
    providerName,
    externalUrl,
  }: {
    userId: number;
    credentials: unknown;
    providerName?: string;
    externalUrl?: string | null;
  }): Promise<string> {
    const client = requirePlaid();
    const result = publicCredentialsSchema.safeParse(credentials);
    if (!result.success) {
      throw new ValidationError({
        code: API_ERROR_CODES.invalidCredentials,
        message: t({ key: 'bankDataProviders.providerNotAvailable' }),
      });
    }
    // An outer transaction could roll back after the exchange, leaving a live Item nobody removes.
    const ambientTransaction = namespace.get('transaction');
    if (ambientTransaction && !ambientTransaction.finished) throw providerUnavailable();
    const name = providerName || (await this.nextConnectionName({ userId, label: this.metadata.name }));
    const { access_token, item_id } = await requestPlaid({
      request: () => client.exchangePublicToken({ publicToken: result.data.publicToken }),
    });
    try {
      return await dbConnection.sequelize.transaction(async () => {
        const connection = await BankDataProviderConnections.create({
          userId,
          providerType: BANK_PROVIDER_TYPE.PLAID,
          providerName: name,
          externalUrl,
          credentials: encryptCredentials({ access_token, item_id }),
          metadata: { plaidCursors: {}, consecutiveAuthFailures: 0, deactivationReason: null } satisfies PlaidMetadata,
        });
        return connection.id;
      });
    } catch (error) {
      logger.error(
        { message: '[Plaid] Failed to save the connection, removing its Item', error: error as Error },
        { itemId: item_id },
      );
      await client.removeItem({ accessToken: access_token }).catch((removeError: unknown) => {
        logger.error('[Plaid] Failed to remove the Item of an unsaved connection', {
          itemId: item_id,
          code: removeError instanceof PlaidApiError ? removeError.code : null,
        });
      });
      throw providerUnavailable();
    }
  }

  async createLinkToken({ userId }: { userId: number }): Promise<PlaidLinkTokenResponse> {
    const client = requirePlaid();
    const linkToken = await requestPlaid({ request: () => client.createLinkToken({ userId }) });
    return { linkToken };
  }

  async validateCredentials(credentials: unknown): Promise<boolean> {
    const config = getPlaidConfig();
    const result = plaidCredentialsSchema.safeParse(credentials);
    if (!config || !result.success) return false;
    const client = new PlaidApiClient({ config });
    return client.getAccounts({ accessToken: result.data.access_token }).then(
      () => true,
      () => false,
    );
  }

  async refreshCredentials(): Promise<void> {
    // A new Item must be connected through Plaid Link.
    throw new NotAllowedError({ message: t({ key: 'bankDataProviders.providerNotAvailable' }) });
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = await getPlaidConnection({ connectionId });
    if (!isRestored({ connection })) {
      let itemId: string | undefined;
      try {
        const client = requirePlaid();
        const credentials = requireCredentials({ connection });
        itemId = credentials.item_id;
        await client.removeItem({ accessToken: credentials.access_token });
      } catch (error) {
        logger.error(
          { message: '[Plaid] Failed to remove the Item, deleting the connection locally', error: error as Error },
          { connectionId, itemId, code: error instanceof PlaidApiError ? error.code : null },
        );
      }
    }
    await connection.destroy();
  }

  async fetchAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const client = requirePlaid();
    const connection = await getPlaidConnection({ connectionId });
    if (!connection.isActive) throw invalidCredentials();
    return this.withAuthTracking({
      connectionId,
      request: () => {
        const { access_token: accessToken } = requireCredentials({ connection });
        return requestPlaid({ connectionId, request: () => getAccounts({ client, accessToken }) });
      },
    });
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
      connectionId,
      systemAccountId,
      userId,
      errorLogMessage: '[Plaid] Failed to sync account',
      work: async () => {
        const client = requirePlaid();
        const connection = await getPlaidConnection({ connectionId });
        if (!connection.isActive) throw invalidCredentials();
        const account = await this.getSystemAccount(systemAccountId);
        const externalId = account.externalId;
        if (!externalId || account.type !== ACCOUNT_TYPES.plaid) throw accountNotLinked();
        const cursor = getCursor({ connection, account });
        // Every local mapping consumes its own checkpoint of the Item-wide stream.
        const [accounts, changes] = await this.withAuthTracking({
          connectionId,
          request: () => {
            const { access_token: accessToken } = requireCredentials({ connection });
            return requestPlaid({
              connectionId,
              request: () =>
                Promise.all([getAccounts({ client, accessToken }), client.syncTransactions({ accessToken, cursor })]),
            });
          },
        });
        const providerAccount = accounts.find((remote) => remote.externalId === externalId);
        if (!providerAccount || providerAccount.currency !== account.currencyCode) throw invalidMapping();

        const locked = await lockLinkedBankAccount({ accountId: systemAccountId, connectionId, externalId });
        if (!locked || locked.type !== ACCOUNT_TYPES.plaid || linkedAt({ account: locked }) !== linkedAt({ account })) {
          throw accountNotLinked();
        }
        const current = await getPlaidConnection({ connectionId, lock: true });
        if (!current.isActive) throw invalidCredentials();
        if (
          requireCredentials({ connection: current }).item_id !== requireCredentials({ connection }).item_id ||
          getCursor({ connection: current, account: locked }) !== cursor
        ) {
          throw new ConflictError({ message: t({ key: 'bankDataProviders.providerNotAvailable' }) });
        }

        const transactionIds = await applyPlaidChanges({
          account: locked,
          externalId,
          changes,
          hasCursor: cursor !== undefined,
          checkpoint: this.createBaseCurrencyLockCheckpoint({ userId }),
        });
        if (providerAccount.balance !== null) {
          // Rebased on the stored limit, so a later Plaid limit change does not move the displayed debt.
          const balance = providerAccount.balance
            .subtract(providerAccount.creditLimit ?? Money.zero())
            .add(locked.creditLimit);
          await writeBankBalanceWithHistory({ account: locked, balance });
        }
        // The first sync may return an empty cursor while Plaid is preparing history.
        if (changes.cursor && changes.cursor !== cursor) {
          const metadata = (current.metadata ?? {}) as PlaidMetadata;
          current.metadata = {
            ...metadata,
            plaidCursors: {
              ...metadata.plaidCursors,
              [systemAccountId]: { externalId, linkedAt: linkedAt({ account: locked }), value: changes.cursor },
            },
          } satisfies PlaidMetadata;
          await current.save();
        }
        return { transactionIds };
      },
    });
  }
}

export const plaidProvider = new PlaidProvider();

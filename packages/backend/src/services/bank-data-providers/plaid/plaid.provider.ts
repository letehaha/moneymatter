import {
  ACCOUNT_TYPES,
  API_ERROR_CODES,
  BANK_PROVIDER_TYPE,
  DEACTIVATION_REASON,
  type PlaidLinkTokenResponse,
  type RecordId,
} from '@bt/shared/types';
import { externalUrl as externalUrlSchema } from '@common/lib/zod/custom-types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ConflictError, ForbiddenError, NotAllowedError, ServiceUnavailableError, ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { connection as dbConnection, namespace } from '@models/connection';
import { lockLinkedBankAccount } from '@services/accounts/lock-account-row';
import { z } from 'zod';

import { AccountUnlinkedDuringSyncError, BaseBankDataProvider } from '../base-provider';
import type { AuthTrackingMetadata, ProviderAccount, ProviderMetadata } from '../types';
import { encryptCredentials } from '../utils/credential-encryption';
import { writeBankBalanceWithHistory } from '../utils/write-bank-balance-with-history';
import { PlaidApiClient, PlaidApiError, getPlaidConfig } from './api-client';
import { applyPlaidChanges } from './apply-transaction-changes';
import { normalizePlaidAccount } from './normalize';
import type { PlaidCredentials, PlaidMetadata } from './types';

const publicCredentialsSchema = z.strictObject({ publicToken: z.string().min(1).max(1024) });
const storedCredentialsSchema = z.strictObject({
  access_token: z.string().min(1),
  item_id: z.string().min(1),
});

const invalidCredentials = () =>
  new ForbiddenError({
    code: API_ERROR_CODES.invalidCredentials,
    message: t({ key: 'bankDataProviders.providerNotAvailable' }),
  });
const accountNotLinked = () =>
  new AccountUnlinkedDuringSyncError({ message: t({ key: 'bankDataProviders.accountNotLinkedToConnection' }) });

const invalidMapping = () =>
  new ConflictError({ message: t({ key: 'bankDataProviders.accountNotLinkedToConnection' }) });

const INVALID_TOKEN_CODES = {
  ITEM_LOGIN_REQUIRED: true,
  ITEM_LOCKED: true,
  USER_SETUP_REQUIRED: true,
  INVALID_ACCESS_TOKEN: true,
  ITEM_NOT_FOUND: true,
  USER_PERMISSION_REVOKED: true,
  INVALID_PUBLIC_TOKEN: true,
} as const;

// Don't carry upstream error bodies or codes into HTTP responses, sync status, or logs.
const requestPlaid = async <T>({ request }: { request: () => Promise<T> }): Promise<T> => {
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof PlaidApiError)) throw error;
    if (error.code && Object.hasOwn(INVALID_TOKEN_CODES, error.code)) throw invalidCredentials();
    throw new ServiceUnavailableError({ message: t({ key: 'bankDataProviders.providerNotAvailable' }) });
  }
};

const requirePlaid = () => {
  const config = getPlaidConfig();
  if (!config) throw new NotAllowedError({ message: t({ key: 'bankDataProviders.providerNotAvailable' }) });
  return { client: new PlaidApiClient({ config }) };
};

const getPlaidConnection = ({
  connectionId,
  userId,
  lock = false,
}: {
  connectionId: string;
  userId?: number;
  lock?: boolean;
}) =>
  findOrThrowNotFound({
    query: BankDataProviderConnections.findOne({
      where: { id: connectionId, providerType: BANK_PROVIDER_TYPE.PLAID, ...(userId !== undefined && { userId }) },
      lock: lock ? namespace.get('transaction').LOCK.NO_KEY_UPDATE : undefined,
    }),
    message: t({ key: 'errors.connectionNotFound' }),
  });

const readCredentials = ({ connection }: { connection: BankDataProviderConnections }): PlaidCredentials | null => {
  if ((connection.metadata as AuthTrackingMetadata | null)?.deactivationReason === DEACTIVATION_REASON.RESTORED)
    return null;
  try {
    const result = storedCredentialsSchema.safeParse(connection.getDecryptedCredentials());
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

const requireCredentials = ({ connection }: { connection: BankDataProviderConnections }) => {
  const credentials = readCredentials({ connection });
  if (!credentials) throw invalidCredentials();
  return credentials;
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
    const { client } = requirePlaid();
    const result = publicCredentialsSchema.safeParse(credentials);
    const nameResult = z.string().min(1).max(255).optional().safeParse(providerName);
    if (!result.success || !nameResult.success || !externalUrlSchema().nullish().safeParse(externalUrl).success) {
      throw new ValidationError({
        code: API_ERROR_CODES.invalidCredentials,
        message: t({ key: 'bankDataProviders.providerNotAvailable' }),
      });
    }
    const ambientTransaction = namespace.get('transaction');
    if (ambientTransaction && !ambientTransaction.finished) {
      throw new ServiceUnavailableError({ message: t({ key: 'bankDataProviders.providerNotAvailable' }) });
    }
    const name = providerName ?? (await this.nextConnectionName({ userId, label: this.metadata.name }));
    if (name.length > 255) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.providerNotAvailable' }) });
    }
    const { access_token, item_id } = await requestPlaid({
      request: () => client.exchangePublicToken({ publicToken: result.data.publicToken }),
    });
    try {
      return await dbConnection.sequelize.transaction(async () => {
        const connection = await BankDataProviderConnections.create({
          userId,
          providerType: BANK_PROVIDER_TYPE.PLAID,
          providerName: name,
          credentials: encryptCredentials({ access_token, item_id }),
          metadata: { plaidCursors: {}, consecutiveAuthFailures: 0, deactivationReason: null } satisfies PlaidMetadata,
        });
        if (externalUrl !== undefined) {
          await BankDataProviderConnections.update({ externalUrl }, { where: { id: connection.id } });
        }
        return connection.id;
      });
    } catch {
      try {
        await client.removeItem({ accessToken: access_token });
      } catch {
        // Cleanup is best effort; do not expose upstream errors or credentials.
      }
      throw new ServiceUnavailableError({ message: t({ key: 'bankDataProviders.providerNotAvailable' }) });
    }
  }

  async createLinkToken({ userId }: { userId: number }): Promise<PlaidLinkTokenResponse> {
    const { client } = requirePlaid();
    const linkToken = await requestPlaid({ request: () => client.createLinkToken({ userId }) });
    return { linkToken };
  }

  async validateCredentials(credentials: unknown): Promise<boolean> {
    const config = getPlaidConfig();
    const result = storedCredentialsSchema.safeParse(credentials);
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
    const restored =
      (connection.metadata as AuthTrackingMetadata | null)?.deactivationReason === DEACTIVATION_REASON.RESTORED;
    if (!restored) {
      const credentials = requireCredentials({ connection });
      const { client } = requirePlaid();
      await requestPlaid({
        request: async () => {
          try {
            await client.removeItem({ accessToken: credentials.access_token });
          } catch (error) {
            if (
              !(error instanceof PlaidApiError) ||
              (error.code !== 'ITEM_NOT_FOUND' && error.code !== 'INVALID_ACCESS_TOKEN')
            )
              throw error;
          }
        },
      });
    }
    await connection.destroy();
  }

  async fetchAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const { client } = requirePlaid();
    const connection = await getPlaidConnection({ connectionId });
    if (!connection.isActive) throw invalidCredentials();
    return this.withAuthTracking({
      connectionId,
      request: () => {
        const { access_token: accessToken } = requireCredentials({ connection });
        return requestPlaid({ request: () => getAccounts({ client, accessToken }) });
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
        const { client } = requirePlaid();
        const connection = await getPlaidConnection({ connectionId, userId });
        if (!connection.isActive) throw invalidCredentials();
        const account = await this.getSystemAccount(systemAccountId);
        const externalId = account.externalId;
        if (
          !externalId ||
          account.userId !== userId ||
          account.type !== ACCOUNT_TYPES.plaid ||
          account.bankDataProviderConnectionId !== connectionId
        ) {
          throw accountNotLinked();
        }
        const cursor = getCursor({ connection, account });
        // Every local mapping consumes its own checkpoint of the Item-wide stream.
        const [accounts, changes] = await this.withAuthTracking({
          connectionId,
          request: () => {
            const { access_token: accessToken } = requireCredentials({ connection });
            return requestPlaid({
              request: () =>
                Promise.all([getAccounts({ client, accessToken }), client.syncTransactions({ accessToken, cursor })]),
            });
          },
        });
        const providerAccount = accounts.find((remote) => remote.externalId === externalId);
        if (!providerAccount || providerAccount.currency !== account.currencyCode) throw invalidMapping();

        const locked = await lockLinkedBankAccount({ accountId: systemAccountId, connectionId, externalId });
        if (
          !locked ||
          locked.userId !== userId ||
          locked.type !== ACCOUNT_TYPES.plaid ||
          linkedAt({ account: locked }) !== linkedAt({ account })
        ) {
          throw accountNotLinked();
        }
        const current = await getPlaidConnection({ connectionId, userId, lock: true });
        if (!current.isActive) throw invalidCredentials();
        const state = requireCredentials({ connection: current });
        const credentials = requireCredentials({ connection });
        if (
          state.access_token !== credentials.access_token ||
          state.item_id !== credentials.item_id ||
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
          await writeBankBalanceWithHistory({ account: locked, balance: providerAccount.balance });
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

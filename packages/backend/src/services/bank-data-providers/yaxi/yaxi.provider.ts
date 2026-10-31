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
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import {
  BadRequestError,
  CustomError,
  ForbiddenError,
  NotAllowedError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '@js/errors';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { findOneTransaction } from '@models/transactions-query';
import { getUserDefaultCategory } from '@models/users.model';
import {
  BaseBankDataProvider,
  type DateRange,
  type ProviderAccount,
  type ProviderBalance,
  type ProviderMetadata,
  type ProviderTransaction,
} from '@services/bank-data-providers';
import { createTransaction } from '@services/transactions';
import { accountHasPlannedRows } from '@services/transactions/planned-matching';
import { subDays } from 'date-fns';
import { createHash } from 'node:crypto';
import { Op, Sequelize } from 'sequelize';

import { isProviderAvailableForUser } from '../provider-availability';
import { SyncStatus, setAccountSyncStatus, setAccountsSyncStatus } from '../sync/sync-status-tracker';
import { clampSyncStartToLink } from '../utils/clamp-sync-start-to-link';
import { encryptCredentials } from '../utils/credential-encryption';
import { linkAndEmitSyncedTransactions } from '../utils/link-and-emit-synced-transactions';
import { notifyPlannedConfirmations } from '../utils/notify-planned-confirmations';
import { writeBankBalanceWithHistory } from '../utils/write-bank-balance-with-history';
import {
  AccessExceededException,
  type Account,
  type AccountReference,
  type Balance,
  CanceledException,
  InterruptErrorException,
  InvalidCredentialsException,
  NotFoundException,
  PeriodOutOfBoundsException,
  ProviderErrorException,
  RequestException,
  ResponseException,
  ServiceBlockedException,
  TicketException,
  type Transaction,
  UnauthorizedException,
  UnexpectedErrorException,
  UnexpectedValueException,
  UnsupportedProductException,
  refreshAccounts,
  refreshBalances,
  refreshTransactions,
  resolveYaxiApiUrl,
  searchConnections,
} from './refresh-client';
import { issueTicket, verifyResultJwt } from './tickets';
import type { YaxiCredentials, YaxiKey, YaxiMetadata, YaxiReadService } from './types';

/** Older rows need a fresh bank login, which a refresh cannot do. */
const MAX_LOOKBACK_DAYS = 89;
const INCREMENTAL_OVERLAP_DAYS = 14;
/** Some banks serve less than the 90 day limit without a fresh login. */
const SHORT_LOOKBACK_DAYS = 30;

// ponytail: pending rows aren't imported yet; add them with a pending-to-booked matcher like Enable Banking's.
const IMPORTED_STATUSES = new Set(['BOOKED', 'INVOICED', 'PAID']);

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_SECRET_BYTES = 16;

const isUpstreamAuthError = ({ error }: { error: unknown }) =>
  error instanceof InterruptErrorException ||
  error instanceof InvalidCredentialsException ||
  error instanceof TicketException ||
  error instanceof UnauthorizedException ||
  error instanceof UnexpectedValueException;

const toApiError = ({ error }: { error: unknown }): unknown => {
  if (error instanceof CustomError) return error;
  if (isUpstreamAuthError({ error })) {
    return new ForbiddenError({ message: t({ key: 'bankDataProviders.yaxi.reauthRequired' }) });
  }
  if (error instanceof AccessExceededException) {
    return new ServiceUnavailableError({
      message: t({ key: 'bankDataProviders.yaxi.accessExceeded' }),
      details: { reason: 'access_exceeded' },
    });
  }
  if (error instanceof NotFoundException) {
    return new NotFoundError({ message: t({ key: 'bankDataProviders.yaxi.accountNotFound' }) });
  }
  if (error instanceof ServiceBlockedException) {
    return new ServiceUnavailableError({ message: t({ key: 'bankDataProviders.yaxi.serviceBlocked' }) });
  }
  if (
    error instanceof RequestException ||
    error instanceof ResponseException ||
    error instanceof ProviderErrorException ||
    error instanceof UnsupportedProductException ||
    error instanceof CanceledException ||
    error instanceof UnexpectedErrorException
  ) {
    logger.warn('[YAXI] Upstream failure reported as unavailable', { exception: error.name, reason: error.message });
    return new ServiceUnavailableError({ message: t({ key: 'bankDataProviders.yaxi.unavailable' }) });
  }
  return error;
};

/** A failure every later upstream call of this connection would hit too, and burn a refresh on. */
const isConnectionWideFailure = ({ error }: { error: unknown }) =>
  error instanceof ForbiddenError || error instanceof ServiceUnavailableError;

const formatDate = ({ date }: { date: Date }) => date.toISOString().slice(0, 10);

const toExternalId = ({ iban, currency }: { iban: string; currency: string }) => `${iban}:${currency}`;

const parseExternalId = ({ externalId }: { externalId: string }) => {
  const [iban, currency] = externalId.split(':') as [string, string];
  return { iban, currency };
};

const normalizeIban = ({ iban }: { iban: string }) => iban.replace(/\s+/g, '').toUpperCase();

const rowDate = ({ row }: { row: Transaction }) => row.bookingDate ?? row.valueDate ?? row.transactionDate;

const isExpenseRow = ({ row }: { row: Transaction }) => Money.fromDecimal(row.amount.amount).isNegative();

/** On a reversal, creditor and debtor describe the original payment, which flips who the other party is. */
const counterpartyOf = ({ row }: { row: Transaction }) =>
  isExpenseRow({ row }) !== Boolean(row.reversal) ? row.creditor : row.debtor;

/**
 * YAXI rows carry no stable ID, so the ID is a hash of the fields the bank keeps fixed. Remittance text is left out
 * because banks rewrite it, and the booking date comes last because banks can add it to a row later. The occurrence
 * index keeps two identical purchases on one day apart; the requested range always starts on a day boundary, so a day
 * is always counted whole.
 */
const assignOriginalIds = ({ rows, accountExternalId }: { rows: Transaction[]; accountExternalId: string }) => {
  const occurrences = new Map<string, number>();

  return rows
    .map((row) => ({ row, sortKey: JSON.stringify(row) }))
    .toSorted((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ row }) => {
      const hash = createHash('sha256')
        .update(
          JSON.stringify([
            accountExternalId,
            Money.fromDecimal(row.amount.amount).toCents(),
            row.amount.currency,
            row.transactionDate ?? row.valueDate ?? row.bookingDate,
            row.endToEndId ?? '',
            counterpartyOf({ row })?.iban ?? '',
          ]),
        )
        .digest('hex');
      const occurrence = occurrences.get(hash) ?? 0;
      occurrences.set(hash, occurrence + 1);

      return { row, originalId: `${hash}-${occurrence}` };
    });
};

const findBalanceFor = ({
  balances,
  iban,
  currency,
}: {
  balances: { account: AccountReference; balances: Balance[] }[];
  iban: string;
  currency?: string;
}): Balance | undefined => {
  const entry = balances.find(
    ({ account }) =>
      'iban' in account &&
      normalizeIban({ iban: account.iban }) === iban &&
      (!currency || !account.currency || account.currency.toUpperCase() === currency),
  );

  // Clients spell the booked type differently ('Booked' vs 'BOOKED').
  return entry?.balances.find((balance) => balance.balanceType.toUpperCase() === 'BOOKED') ?? entry?.balances[0];
};

/** Docs: https://docs.yaxi.tech/ */
export class YaxiProvider extends BaseBankDataProvider {
  readonly metadata: ProviderMetadata = {
    type: BANK_PROVIDER_TYPE.YAXI,
    name: 'YAXI',
    description: 'Sync transactions from European banks with your own free YAXI key',
    documentationUrl: 'https://docs.yaxi.tech/',
    features: {
      supportsWebhooks: false,
      supportsRealtime: false,
      requiresReauth: true,
      supportsManualSync: true,
      supportsAutoSync: true,
      defaultSyncInterval: 12 * 60 * 60 * 1000, // 12 hours
      minSyncInterval: 6 * 60 * 60 * 1000, // 6 hours
    },
  };

  protected override isAuthError(error: unknown): boolean {
    return isUpstreamAuthError({ error }) || super.isAuthError(error);
  }

  async connect(userId: number, credentials: unknown): Promise<string> {
    const key = this.parseKey({ credentials });
    if (!key) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.yaxi.invalidCredentialsFormat' }) });
    }

    if (!(await this.validateCredentials(key))) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.yaxi.invalidKey' }) });
    }

    const existingConnections = await BankDataProviderConnections.findAll({
      where: { userId, providerType: this.metadata.type },
    });

    // An abandoned first login leaves a row behind; retrying with the same key continues it.
    const abandoned = existingConnections.find(
      (connection) =>
        !connection.isActive &&
        !(connection.metadata as YaxiMetadata | null)?.bankConnectionId &&
        connection.getDecryptedCredentials().keyId === key.keyId,
    );
    if (abandoned) {
      abandoned.setEncryptedCredentials({ ...key } satisfies YaxiCredentials);
      await abandoned.save();
      return abandoned.id;
    }

    const connection = await BankDataProviderConnections.create({
      userId,
      providerType: this.metadata.type,
      providerName: existingConnections.length > 0 ? `YAXI (${existingConnections.length + 1})` : 'YAXI',
      isActive: false, // Activated once the browser login completes
      credentials: encryptCredentials({ ...key } satisfies YaxiCredentials),
      metadata: { consecutiveAuthFailures: 0, deactivationReason: null } satisfies YaxiMetadata,
    } as any);

    return connection.id;
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    await connection.destroy();
  }

  async validateCredentials(credentials: unknown): Promise<boolean> {
    const key = this.parseKey({ credentials });
    if (!key) return false;

    try {
      const { ticket } = issueTicket({ key, service: 'Accounts' });
      await searchConnections({ keyId: key.keyId, ticket, term: 'bank' });
      return true;
    } catch (error) {
      if (error instanceof TicketException || error instanceof UnauthorizedException) return false;
      throw toApiError({ error });
    }
  }

  async refreshCredentials(connectionId: string, newCredentials: unknown): Promise<void> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);
    await this.assertAvailable({ userId: connection.userId });

    const key = this.parseKey({ credentials: newCredentials });
    if (!key) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.yaxi.invalidCredentialsFormat' }) });
    }

    if (!(await this.validateCredentials(key))) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.yaxi.invalidKey' }) });
    }

    await this.rewriteCredentials({
      connectionId,
      update: ({ connectionData }) => ({ ...key, connectionData }),
    });
  }

  /** Starts a browser login. Always an Accounts ticket: nothing here can ever authorize a payment. */
  async issueBrowserTicket({
    connectionId,
    userId,
  }: {
    connectionId: string;
    userId: number;
  }): Promise<{ ticket: string; apiUrl: string }> {
    const connection = await this.getOwnConnection({ connectionId, userId });
    const key = this.parseStoredCredentials({ connection });
    const { ticket, ticketId } = issueTicket({ key, service: 'Accounts' });

    connection.metadata = { ...(connection.metadata as YaxiMetadata), expectedTicketId: ticketId } as any;
    await connection.save();

    return { ticket, apiUrl: resolveYaxiApiUrl({ keyId: key.keyId }) };
  }

  /** Finishes a browser login, for a new connection or to reconnect an expired one with its accounts intact. */
  async completeConnection({
    connectionId,
    userId,
    resultJwt,
    connectionData,
    bankConnectionId,
    bankName,
    logoId,
  }: {
    connectionId: string;
    userId: number;
    resultJwt: string;
    connectionData: string;
    bankConnectionId: string;
    bankName: string;
    logoId?: string | null;
  }): Promise<void> {
    const connection = await this.getOwnConnection({ connectionId, userId });
    const metadata = connection.metadata as YaxiMetadata | null;
    const key = this.parseStoredCredentials({ connection });

    // Consumed under the row lock below; checked here too so a bad JWT never costs an upstream call.
    const verified = verifyResultJwt({ jwt: resultJwt, secret: key.secret });
    if (!verified || !metadata?.expectedTicketId || verified.ticketId !== metadata.expectedTicketId) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.yaxi.invalidResult' }) });
    }

    let validated: Awaited<ReturnType<typeof refreshAccounts>>;
    try {
      const { ticket } = issueTicket({ key, service: 'Accounts' });
      validated = await refreshAccounts({ keyId: key.keyId, ticket, connectionData });
    } catch (error) {
      const apiError = toApiError({ error });
      throw apiError instanceof ForbiddenError
        ? new ValidationError({ message: t({ key: 'bankDataProviders.yaxi.invalidConnectionData' }) })
        : apiError;
    }

    const linkedAccounts = await Accounts.findAll({
      where: { bankDataProviderConnectionId: connectionId },
      attributes: ['externalId'],
    });
    const loggedInIbans = new Set(validated.result.flatMap(({ iban }) => (iban ? [normalizeIban({ iban })] : [])));
    const stillSeesLinkedAccount = linkedAccounts.some(({ externalId }) =>
      loggedInIbans.has(parseExternalId({ externalId }).iban),
    );
    if (linkedAccounts.length > 0 && !stillSeesLinkedAccount) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.yaxi.differentBankLogin' }) });
    }

    await BankDataProviderConnections.sequelize!.transaction(async (transaction) => {
      const locked = await BankDataProviderConnections.findByPk(connectionId, {
        transaction,
        lock: transaction.LOCK.NO_KEY_UPDATE,
      });
      const lockedMetadata = locked?.metadata as YaxiMetadata | null | undefined;
      if (!locked || lockedMetadata?.expectedTicketId !== verified.ticketId) {
        throw new ValidationError({ message: t({ key: 'bankDataProviders.yaxi.invalidResult' }) });
      }

      const { keyId, secret } = this.parseStoredCredentials({ connection: locked });
      locked.setEncryptedCredentials({
        keyId,
        secret,
        connectionData: validated.connectionData ?? connectionData,
      } satisfies YaxiCredentials);
      locked.metadata = {
        ...lockedMetadata,
        expectedTicketId: null,
        bankConnectionId,
        bankName,
        logoId: logoId ?? null,
        accountCount: validated.result.length,
        consecutiveAuthFailures: 0,
        deactivationReason: null,
      } satisfies YaxiMetadata;
      if (!lockedMetadata.bankConnectionId) locked.providerName = bankName;
      locked.isActive = true;

      await locked.save({ transaction });
    });
  }

  async fetchAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const connection = await this.getConnection(connectionId);
    const metadata = connection.metadata as YaxiMetadata;

    const accounts = await this.callUpstream({
      connectionId,
      service: 'Accounts',
      call: refreshAccounts,
    });

    const withIban = accounts.filter((account): account is Account & { iban: string } => Boolean(account.iban));
    if (withIban.length < accounts.length) {
      // ponytail: IBAN-less accounts (cards known only by masked PAN) can't be imported; add AccountReference support.
      logger.info(`[YAXI] Skipped ${accounts.length - withIban.length} account(s) without an IBAN`, { connectionId });
    }
    if (withIban.length === 0) return [];

    const balances = await this.fetchBalances({
      connectionId,
      references: withIban.map((account) => ({
        iban: account.iban,
        ...(account.currency && { currency: account.currency }),
      })),
    });
    await this.resetAuthFailures(connectionId);

    return withIban.flatMap((account) => {
      const iban = normalizeIban({ iban: account.iban });
      const balance = findBalanceFor({ balances, iban, currency: account.currency?.toUpperCase() });
      const currency = (account.currency ?? balance?.currency)?.toUpperCase();
      if (!currency) {
        logger.warn('[YAXI] Skipped an account the bank reports without a currency', { connectionId });
        return [];
      }
      if (!balance) {
        logger.warn('[YAXI] Account has no balance in the response, reporting 0', { connectionId });
      }

      return [
        {
          externalId: toExternalId({ iban, currency }),
          name: account.displayName || account.name || iban,
          type: 'bank' as const,
          balance: this.balanceCents({ balance }),
          currency,
          metadata: {
            institutionName: metadata.bankName ?? null,
            iban,
            holder: account.ownerName ?? null,
            yaxiType: account.type ?? null,
          },
        },
      ];
    });
  }

  async fetchTransactions(
    connectionId: string,
    accountExternalId: string,
    dateRange?: DateRange,
  ): Promise<ProviderTransaction[]> {
    const rows = await this.fetchRows({ connectionId, externalId: accountExternalId, from: dateRange?.from });
    await this.resetAuthFailures(connectionId);

    return assignOriginalIds({ rows, accountExternalId }).map(({ row, originalId }) => ({
      externalId: originalId,
      amount: Money.fromDecimal(row.amount.amount).toCents(),
      currency: row.amount.currency,
      date: new Date(rowDate({ row })!),
      description: row.remittanceInformation?.join(' ') ?? '',
      merchantName: counterpartyOf({ row })?.name ?? undefined,
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
      errorLogMessage: '[YAXI] Sync error:',
      work: async () => {
        const account = await this.getSystemAccount(systemAccountId);
        const connection = await this.getConnection(connectionId);
        this.validateProviderType(connection);

        const balances = await this.fetchBalances({
          connectionId,
          references: [this.accountReference({ account })],
        });
        const transactionIds = await this.syncAccount({ connection, account, balances });
        await this.resetAuthFailures(connectionId);

        return { transactionIds };
      },
    });
  }

  /** One queue job per connection: each account is synced in turn, so one job never races its own rotated copies. */
  async syncConnectionAccounts({
    connectionId,
    userId,
    systemAccountIds,
  }: {
    connectionId: string;
    userId: number;
    systemAccountIds: RecordId[];
  }): Promise<void> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    const accounts = await Accounts.findAll({
      where: { id: systemAccountIds, bankDataProviderConnectionId: connectionId },
    });
    if (accounts.length === 0) return;

    const accountIds = accounts.map((account) => account.id);
    await setAccountsSyncStatus({ accountIds, status: SyncStatus.SYNCING, userId });

    const failAll = async ({ ids, error }: { ids: RecordId[]; error: unknown }) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.info('[YAXI] Connection sync stopped', { connectionId, reason: message });
      await setAccountsSyncStatus({ accountIds: ids, status: SyncStatus.FAILED, error: message, userId });
    };

    let balances: { account: AccountReference; balances: Balance[] }[];
    try {
      balances = await this.fetchBalances({
        connectionId,
        references: accounts.map((account) => this.accountReference({ account })),
      });
    } catch (error) {
      await failAll({ ids: accountIds, error });
      if (isConnectionWideFailure({ error })) return;
      throw error;
    }

    let anyAccountSynced = false;
    for (const [index, account] of accounts.entries()) {
      try {
        const transactionIds = await this.syncAccount({ connection, account, balances });
        await linkAndEmitSyncedTransactions({ userId, accountId: account.id, transactionIds });
        await setAccountSyncStatus({ accountId: account.id, status: SyncStatus.COMPLETED, userId });
        anyAccountSynced = true;
      } catch (error) {
        if (isConnectionWideFailure({ error })) {
          await failAll({ ids: accountIds.slice(index), error });
          if (anyAccountSynced) await this.updateLastSync(connectionId);
          return;
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ message: `[YAXI] Sync error for account ${account.id}:`, error: error as Error });
        await setAccountSyncStatus({ accountId: account.id, status: SyncStatus.FAILED, error: message, userId });
      }
    }

    await this.resetAuthFailures(connectionId);
    if (anyAccountSynced) await this.updateLastSync(connectionId);
  }

  async fetchBalance(connectionId: string, accountExternalId: string): Promise<ProviderBalance> {
    const { iban, currency } = parseExternalId({ externalId: accountExternalId });
    const balances = await this.fetchBalances({ connectionId, references: [{ iban, currency }] });
    await this.resetAuthFailures(connectionId);

    const balance = findBalanceFor({ balances, iban, currency });
    return {
      amount: this.balanceCents({ balance }),
      currency,
      asOf: balance?.dateTime ? new Date(balance.dateTime) : new Date(),
    };
  }

  async refreshBalance(connectionId: string, systemAccountId: string): Promise<void> {
    const account = await this.getSystemAccount(systemAccountId);
    const reference = this.accountReference({ account });
    const balances = await this.fetchBalances({ connectionId, references: [reference] });
    await this.resetAuthFailures(connectionId);

    await this.writeBalance({ account, balances });
  }

  /**
   * Every call to YAXI goes through here. Credentials are re-read per call and a returned connection data copy is
   * saved straight away.
   */
  private async callUpstream<T>({
    connectionId,
    service,
    ticketData,
    call,
  }: {
    connectionId: string;
    service: YaxiReadService;
    ticketData?: unknown;
    call: (params: {
      keyId: string;
      ticket: string;
      connectionData: string;
    }) => Promise<{ result: T; connectionData?: string }>;
  }): Promise<T> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);
    const credentials = this.parseStoredCredentials({ connection });
    if (!connection.isActive || !credentials.connectionData) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.yaxi.reauthRequired' }) });
    }

    try {
      const { ticket } = issueTicket({ key: credentials, service, data: ticketData });
      const { result, connectionData } = await call({
        keyId: credentials.keyId,
        ticket,
        connectionData: credentials.connectionData,
      });

      if (connectionData) {
        // ponytail: overlapping calls keep the first rotated copy saved, not always the newest. Add a per-connection
        // lock if YAXI ever rejects a superseded copy. A differing stored copy can be a fresh login, which must win.
        await this.rewriteCredentials({
          connectionId,
          update: (stored) =>
            stored.connectionData === credentials.connectionData ? { ...stored, connectionData } : null,
        });
      }

      return result;
    } catch (error) {
      await this.handleAuthError({ connectionId, error });
      throw toApiError({ error });
    }
  }

  /**
   * Applies a change to the credentials as they are now, not as they were before a network call. Its own transaction,
   * so a rollback of an ambient sync can't lose a rotated copy. Callers must not hold this row's lock.
   */
  private async rewriteCredentials({
    connectionId,
    update,
  }: {
    connectionId: string;
    update: (stored: YaxiCredentials) => YaxiCredentials | null;
  }): Promise<void> {
    await BankDataProviderConnections.sequelize!.transaction(async (transaction) => {
      const connection = await BankDataProviderConnections.findByPk(connectionId, {
        transaction,
        // Not FOR UPDATE: that conflicts with the FK share lock a caller's open transaction holds after writing
        // an account row that references this connection, and the caller is waiting on this call.
        lock: transaction.LOCK.NO_KEY_UPDATE,
      });
      if (!connection) return;

      const next = update(connection.getDecryptedCredentials() as unknown as YaxiCredentials);
      if (!next) return;

      connection.setEncryptedCredentials({ ...next });
      await connection.save({ transaction });
    });
  }

  private async fetchBalances({ connectionId, references }: { connectionId: string; references: AccountReference[] }) {
    const { balances } = await this.callUpstream({
      connectionId,
      service: 'Balances',
      call: (params) => refreshBalances({ ...params, accounts: references }),
    });

    return balances;
  }

  private async fetchRows({
    connectionId,
    externalId,
    from,
  }: {
    connectionId: string;
    externalId: string;
    from?: Date;
  }): Promise<Transaction[]> {
    const { iban, currency } = parseExternalId({ externalId });
    const floor = subDays(new Date(), MAX_LOOKBACK_DAYS);
    if (from && from < floor) {
      logger.warn('[YAXI] Rows older than the lookback limit cannot be fetched without a fresh bank login', {
        connectionId,
        requestedFrom: formatDate({ date: from }),
      });
    }
    const rangeFrom = from && from > floor ? from : floor;

    let rows: Awaited<ReturnType<typeof refreshTransactions>>['result'];
    try {
      rows = await this.callUpstream({
        connectionId,
        service: 'Transactions',
        ticketData: { account: { iban, currency }, range: { from: formatDate({ date: rangeFrom }) } },
        call: refreshTransactions,
      });
    } catch (error) {
      if (!(error instanceof PeriodOutOfBoundsException)) throw error;

      const shorterFrom = subDays(new Date(), SHORT_LOOKBACK_DAYS);
      if (formatDate({ date: rangeFrom }) >= formatDate({ date: shorterFrom })) {
        const reauthError = new ForbiddenError({ message: t({ key: 'bankDataProviders.yaxi.reauthRequired' }) });
        await this.handleAuthError({ connectionId, error: reauthError });
        throw reauthError;
      }
      logger.warn('[YAXI] Bank refused the full lookback, falling back to the shorter window', { connectionId });
      return this.fetchRows({ connectionId, externalId, from: shorterFrom });
    }

    const fetched = rows ?? [];
    const imported = fetched.filter((row) => IMPORTED_STATUSES.has(row.status.toUpperCase()));
    if (imported.length < fetched.length) {
      logger.info(`[YAXI] Skipped ${fetched.length - imported.length} row(s) by status`, { connectionId });
    }
    const dated = imported.filter((row) => rowDate({ row }));
    if (dated.length < imported.length) {
      logger.info(`[YAXI] Skipped ${imported.length - dated.length} settled row(s) without any date`, { connectionId });
    }
    // Storing these would book the number in the account's currency.
    const sameCurrency = dated.filter((row) => row.amount.currency.toUpperCase() === currency.toUpperCase());
    if (sameCurrency.length < dated.length) {
      logger.warn('[YAXI] Skipped rows in a currency other than the account currency', {
        connectionId,
        count: dated.length - sameCurrency.length,
      });
    }

    return sameCurrency;
  }

  private async syncAccount({
    connection,
    account,
    balances,
  }: {
    connection: BankDataProviderConnections;
    account: Accounts;
    balances: { account: AccountReference; balances: Balance[] }[];
  }): Promise<string[]> {
    if (!account.externalId) {
      throw new BadRequestError({ message: t({ key: 'bankDataProviders.yaxi.accountNoExternalId' }) });
    }

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

    const rows = await this.fetchRows({
      connectionId: connection.id,
      externalId: account.externalId,
      from: newestImported ? subDays(new Date(newestImported.time), INCREMENTAL_OVERLAP_DAYS) : undefined,
    });

    const { createdTransactionIds, mergedIntoPlannedCount } = await this.persistTransactions({
      connection,
      account,
      rows,
      matchPlanned: Boolean(anyStoredTransaction) && (await accountHasPlannedRows({ accountId: account.id })),
      createFromDate: anyStoredTransaction ? clampSyncStartToLink({ account, from: new Date(0) }) : new Date(0),
    });

    if (mergedIntoPlannedCount > 0) {
      await notifyPlannedConfirmations({
        userId: connection.userId,
        accountId: account.id,
        mergedCount: mergedIntoPlannedCount,
      });
    }

    await this.writeBalance({ account, balances });
    logger.info(`[YAXI] Sync: ${createdTransactionIds.length} transactions created for account ${account.id}`);

    return createdTransactionIds;
  }

  /**
   * Dedup is two-tier: primary by `originalId`, secondary by
   * `externalData.originalSource.originalId` (covers unlink→relink, restoring `originalId` on a hit).
   */
  private async persistTransactions({
    connection,
    account,
    rows,
    matchPlanned,
    createFromDate,
  }: {
    connection: BankDataProviderConnections;
    account: Accounts;
    rows: Transaction[];
    matchPlanned: boolean;
    createFromDate: Date;
  }) {
    const defaultCategoryId = await getUserDefaultCategory({ id: connection.userId });
    const createdTransactionIds: string[] = [];
    let mergedIntoPlannedCount = 0;
    const checkpoint = this.createBaseCurrencyLockCheckpoint({ userId: connection.userId });

    // Persist in ledger order so planned-merge sees transactions ascending.
    const ascending = assignOriginalIds({ rows, accountExternalId: account.externalId }).toSorted((a, b) =>
      rowDate({ row: a.row })!.localeCompare(rowDate({ row: b.row })!),
    );

    for (const { row, originalId } of ascending) {
      await checkpoint();

      const existingTx = await findOneTransaction({
        planned: 'exclude',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        where: { accountId: account.id, originalId },
        paranoid: false,
      });
      if (existingTx) continue;

      const existingByOriginalSource = await findOneTransaction({
        planned: 'exclude',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        where: Sequelize.and(
          { accountId: account.id, originalId: null },
          Sequelize.where(Sequelize.literal(`"externalData"#>>'{originalSource,originalId}'`), originalId),
        ),
        paranoid: false,
      });
      if (existingByOriginalSource) {
        await existingByOriginalSource.update({ originalId });
        continue;
      }

      const time = new Date(rowDate({ row })!);
      // Rows before the link day are absorbed into the opening balance. Bank dates have no time, so a link-day row may
      // be newer than the link; the link's own sync imports those rows before its residual absorb, so none double-count.
      if (formatDate({ date: time }) < formatDate({ date: createFromDate })) continue;

      const isExpense = isExpenseRow({ row });
      const createResult = await createTransaction({
        originalId,
        note: row.remittanceInformation?.join(' ') ?? '',
        amount: Money.fromDecimal(row.amount.amount).abs(),
        time,
        externalData: {
          entryReference: row.entryReference ?? null,
          endToEndId: row.endToEndId ?? null,
          bookingDate: row.bookingDate ?? null,
          valueDate: row.valueDate ?? null,
          creditorName: row.creditor?.name ?? null,
          creditorIban: row.creditor?.iban ?? null,
          debtorName: row.debtor?.name ?? null,
          debtorIban: row.debtor?.iban ?? null,
        },
        commissionRate: Money.fromCents(0),
        cashbackAmount: Money.fromCents(0),
        accountId: account.id,
        userId: connection.userId,
        transactionType: isExpense ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
        categoryId: defaultCategoryId,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        accountType: ACCOUNT_TYPES.yaxi,
        rawMerchantName: counterpartyOf({ row })?.name?.trim() || null,
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

    return { createdTransactionIds, mergedIntoPlannedCount };
  }

  private async writeBalance({
    account,
    balances,
  }: {
    account: Accounts;
    balances: { account: AccountReference; balances: Balance[] }[];
  }): Promise<void> {
    const { iban, currency } = parseExternalId({ externalId: account.externalId });
    const balance = findBalanceFor({ balances, iban, currency });
    if (!balance) {
      logger.warn('[YAXI] Account has no balance in the response, balance left unchanged', { accountId: account.id });
      return;
    }

    await writeBankBalanceWithHistory({ account, balance: Money.fromDecimal(balance.amount) });
  }

  private accountReference({ account }: { account: Accounts }): AccountReference {
    if (!account.externalId) {
      throw new BadRequestError({ message: t({ key: 'bankDataProviders.yaxi.accountNoExternalId' }) });
    }
    return parseExternalId({ externalId: account.externalId });
  }

  private balanceCents({ balance }: { balance?: Balance }): Cents {
    return balance ? Money.fromDecimal(balance.amount).toCents() : asCents(0);
  }

  private async assertAvailable({ userId }: { userId: number }): Promise<void> {
    if (!(await isProviderAvailableForUser({ userId, providerType: this.metadata.type }))) {
      throw new NotAllowedError({ message: t({ key: 'bankDataProviders.providerNotAvailable' }) });
    }
  }

  private async getOwnConnection({ connectionId, userId }: { connectionId: string; userId: number }) {
    await this.assertAvailable({ userId });

    return findOrThrowNotFound({
      query: BankDataProviderConnections.findOne({
        where: { id: connectionId, userId, providerType: this.metadata.type },
      }),
      message: t({ key: 'errors.connectionNotFound' }),
    });
  }

  private parseKey({ credentials }: { credentials: unknown }): YaxiKey | null {
    if (typeof credentials !== 'object' || credentials === null) return null;

    const { keyId, secret } = credentials as Record<string, unknown>;
    if (typeof keyId !== 'string' || typeof secret !== 'string') return null;

    const key = { keyId: keyId.trim(), secret: secret.trim() };
    const isValid =
      key.keyId.length > 0 &&
      key.keyId.length <= 255 &&
      BASE64_PATTERN.test(key.secret) &&
      Buffer.from(key.secret, 'base64').length >= MIN_SECRET_BYTES;

    return isValid ? key : null;
  }

  /** A backup restore leaves empty credentials behind, so stored values are checked like user input. */
  private parseStoredCredentials({ connection }: { connection: BankDataProviderConnections }): YaxiCredentials {
    const credentials = connection.getDecryptedCredentials();
    const key = this.parseKey({ credentials });
    if (!key) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.yaxi.invalidCredentialsFormat' }) });
    }

    const { connectionData } = credentials as { connectionData?: string };
    return { ...key, connectionData };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ACCOUNT_TYPES,
  BANK_PROVIDER_TYPE,
  NO_CURRENCY_CODE,
  PAYMENT_TYPES,
  type RecordId,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { BadRequestError, ForbiddenError, NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import { findOneTransaction } from '@models/transactions-query';
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
import { subDays } from 'date-fns';
import { Op, Sequelize } from 'sequelize';

import { SyncStatus, setAccountSyncStatus } from '../sync/sync-status-tracker';
import { clampSyncStartToLink } from '../utils/clamp-sync-start-to-link';
import { encryptCredentials } from '../utils/credential-encryption';
import { linkAndEmitSyncedTransactions } from '../utils/link-and-emit-synced-transactions';
import { notifyPlannedConfirmations } from '../utils/notify-planned-confirmations';
import { writeBankBalanceWithHistory } from '../utils/write-bank-balance-with-history';
import { SimplefinApiClient } from './api-client';
import {
  SimplefinAccount,
  SimplefinAccountSet,
  SimplefinConnectInput,
  SimplefinConnection,
  SimplefinCredentials,
  SimplefinGetAccountsParams,
  SimplefinMetadata,
  SimplefinTransaction,
} from './types';

/**
 * SimpleFIN's hard per-query cap is 90 days, but the Bridge now warns when a
 * range exceeds a *recommended* 45 days ("In the future, this may be capped").
 * We page in 44-day windows to stay safely under that recommendation (and the
 * exclusive end-date means a window spans exactly its width). Batched fetching
 * keeps the request count low despite the smaller windows: ~5 requests for the
 * 180-day initial backfill, ~9 for a full-year period load, regardless of how
 * many accounts are synced.
 */
const MAX_WINDOW_MS = 44 * 24 * 60 * 60 * 1000;

/**
 * How far back the first sync of a freshly-connected account reaches. Kept
 * modest (not a full year) so the initial backfill stays within SimpleFIN's
 * daily request budget — ~5 windows at {@link MAX_WINDOW_MS}. Users can pull
 * older history on demand via the "load transactions for period" picker.
 */
const INITIAL_BACKFILL_DAYS = 180;
const SIMPLEFIN_EXPECTED_AUTH_CODES = new Set(['gen.auth', 'con.auth']);

/** Per-account slice of a batched windowed `/accounts` fetch. */
interface AccountTransactionsBucket {
  transactions: SimplefinTransaction[];
  balance: string | null;
  currency: string | null;
}

/**
 * Split [from, to] into contiguous windows no longer than the SimpleFIN
 * per-request limit. `start-date` is inclusive and `end-date` is exclusive, so
 * each window starts exactly where the previous one ended — no gap, and the
 * one-second overlap at the boundary is absorbed by id-based dedup downstream.
 */
function splitIntoWindows(from: Date, to: Date): { from: Date; to: Date }[] {
  const windows: { from: Date; to: Date }[] = [];
  const end = to.getTime();
  let cursor = from.getTime();

  while (cursor < end) {
    const windowEnd = Math.min(cursor + MAX_WINDOW_MS, end);
    windows.push({ from: new Date(cursor), to: new Date(windowEnd) });
    if (windowEnd >= end) break;
    cursor = windowEnd;
  }

  // Degenerate range (from === to): still issue one zero-width window so the
  // caller gets the account's current balance back.
  if (windows.length === 0) {
    windows.push({ from: new Date(from.getTime()), to: new Date(end) });
  }

  return windows;
}

/**
 * SimpleFIN Bridge provider.
 *
 * SimpleFIN is a polling protocol (≈24 requests/day budget), so syncs run
 * inline like LunchFlow rather than through a job queue. Amounts arrive as
 * decimal strings and timestamps as UNIX epoch seconds. We request protocol
 * v2: structured errors (`errlist`) and top-level `connections` for org info.
 */
export class SimplefinProvider extends BaseBankDataProvider {
  readonly metadata: ProviderMetadata = {
    type: BANK_PROVIDER_TYPE.SIMPLEFIN,
    name: 'SimpleFIN',
    description: 'Sync transactions from US banks via the SimpleFIN Bridge',
    documentationUrl: 'https://beta-bridge.simplefin.org/',
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
    if (!this.isValidConnectInput(credentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.simplefin.invalidCredentialsFormat' }) });
    }

    // Exchange the one-time setup token for a long-lived Access URL. Throws a
    // ForbiddenError for a used/invalid token, so no connection is created.
    const accessUrl = await SimplefinApiClient.claimAccessUrl(credentials.setupToken);

    // Probe the Access URL. This both validates auth and gives us the org name
    // + account count for metadata — one call, mindful of the request budget.
    const apiClient = new SimplefinApiClient(accessUrl);
    const accountSet = await apiClient.getAccounts({ balancesOnly: true });
    // Fail the connect if the bridge reports an auth/connection problem even on
    // a 200 (no connection row should be created for bad credentials).
    this.surfaceAccountSetErrors(accountSet);

    const connectionsById = this.buildConnectionsMap(accountSet);
    const firstAccount = accountSet.accounts[0];

    const existingConnections = await BankDataProviderConnections.count({
      where: { userId, providerType: this.metadata.type },
    });
    const providerName = existingConnections > 0 ? `SimpleFIN (${existingConnections + 1})` : 'SimpleFIN';

    const connection = await BankDataProviderConnections.create({
      userId,
      providerType: this.metadata.type,
      providerName,
      isActive: true,
      credentials: encryptCredentials({ accessUrl } satisfies SimplefinCredentials),
      metadata: {
        orgName: firstAccount ? this.resolveOrg(firstAccount, connectionsById).name : undefined,
        accountCount: accountSet.accounts.length,
        consecutiveAuthFailures: 0,
        deactivationReason: null,
      } as SimplefinMetadata,
    } as any);

    return connection.id;
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    await connection.destroy();
  }

  async validateCredentials(credentials: unknown): Promise<boolean> {
    if (!this.isValidStoredCredentials(credentials)) {
      return false;
    }

    const apiClient = new SimplefinApiClient(credentials.accessUrl);

    return await apiClient.testConnection();
  }

  async refreshCredentials(connectionId: string, newCredentials: unknown): Promise<void> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    // Accept either a fresh setup token (claimed into an Access URL) or an
    // Access URL pasted directly (advanced / self-hosted servers).
    let accessUrl: string;
    if (this.isValidConnectInput(newCredentials)) {
      accessUrl = await SimplefinApiClient.claimAccessUrl(newCredentials.setupToken);
    } else if (this.isValidStoredCredentials(newCredentials)) {
      accessUrl = newCredentials.accessUrl;
    } else {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.simplefin.invalidCredentialsFormat' }) });
    }

    const isValid = await this.validateCredentials({ accessUrl });
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.simplefin.invalidAccessUrl' }) });
    }

    connection.setEncryptedCredentials({ accessUrl } satisfies SimplefinCredentials);

    // Reset auth-failure tracking and reactivate. Spread into a new object so
    // Sequelize flags the JSONB column dirty (a same-reference re-assign won't
    // persist the reset of consecutiveAuthFailures / deactivationReason).
    const metadata: SimplefinMetadata = { ...(connection.metadata as SimplefinMetadata) };
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
    const { accessUrl } = await this.getValidatedCredentials(connectionId);
    const apiClient = new SimplefinApiClient(accessUrl);

    const accountSet = await this.getAccountsTracked({ connectionId, apiClient, params: { balancesOnly: true } });
    const connectionsById = this.buildConnectionsMap(accountSet);

    return accountSet.accounts.reduce<ProviderAccount[]>((result, account) => {
      // Some institutions (brokerages, mostly) report no currency at all.
      // Surface those as ISO "XXX" (no currency) instead of hiding the account:
      // connect then requires the user to pick a currency explicitly.
      const currency = account.currency?.toUpperCase() || NO_CURRENCY_CODE;

      // SimpleFIN currency may also be a URL (crypto / non-standard). The rest
      // of the app keys accounts on ISO 4217 codes, so skip anything that isn't
      // a recognizable 3-letter code rather than fail the whole connection.
      if (!this.isIsoCurrency(currency)) {
        logger.info(
          `[SimpleFIN] Skipping account ${account.id} (${account.name}): unsupported currency "${account.currency}"`,
        );
        return result;
      }

      const org = this.resolveOrg(account, connectionsById);

      result.push({
        externalId: account.id,
        name: account.name,
        type: 'bank' as const,
        balance: Money.fromDecimal(account.balance).toCents(),
        currency,
        metadata: {
          institutionName: org.name,
          institutionDomain: org.domain,
          sfinUrl: org.sfinUrl,
          availableBalance: account['available-balance'],
        },
      });
      return result;
    }, []);
  }

  // ============================================================================
  // Transaction Operations
  // ============================================================================

  async fetchTransactions(
    connectionId: string,
    accountExternalId: string,
    dateRange?: DateRange,
  ): Promise<ProviderTransaction[]> {
    const { accessUrl } = await this.getValidatedCredentials(connectionId);
    const apiClient = new SimplefinApiClient(accessUrl);

    const to = dateRange?.to ?? new Date();
    const from = dateRange?.from ?? subDays(to, INITIAL_BACKFILL_DAYS);

    const { transactions, currency } = await this.fetchAccountTransactions({
      connectionId,
      apiClient,
      accountExternalId,
      from,
      to,
    });

    return transactions.map((tx) => ({
      externalId: tx.id,
      amount: Money.fromDecimal(tx.amount).toCents(),
      currency: (currency || '').toUpperCase(),
      // `transacted_at` is the actual purchase moment; `posted` is when the
      // bank cleared it. Prefer the former when the bridge supplies it so
      // transactions land on the day the user spent the money.
      date: new Date((tx.transacted_at ?? tx.posted) * 1000),
      description: tx.description || tx.payee || tx.memo || '',
      merchantName: tx.payee,
      metadata: { payee: tx.payee, memo: tx.memo, posted: tx.posted, transactedAt: tx.transacted_at },
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
    await this.ingestWithStatus({
      connectionId,
      systemAccountId,
      userId,
      logLabel: 'Sync',
      resolveWindow: async ({ account }) => {
        const to = new Date();
        const anchor = await this.findAnchor({ accountId: systemAccountId, to });

        return {
          // Clamped to the link date: the bank's copy of a pre-link manual row carries no id dedup can match.
          // An account with no rows backfills instead.
          from: anchor ? clampSyncStartToLink({ account, from: anchor }) : subDays(to, INITIAL_BACKFILL_DAYS),
          to,
          // Only an anchored (incremental) sync may consume plans: the anchorless
          // backfill window would let old charges eat fresh plans.
          matchPlanned: anchor !== null,
        };
      },
    });
  }

  /**
   * Connection-level batched sync (opt-in capability used by the initial
   * backfill and the daily/manual sync). Fetches each window ONCE for the whole
   * connection — `/accounts` returns every account with its nested transactions
   * in a single reply — and splits the result per account, so the request cost
   * is `windows`, not `accounts × windows`. Other providers, which can't batch,
   * keep the per-account path.
   *
   * Each account is marked SYNCING up front (the header shows the whole
   * connection syncing) then COMPLETED/FAILED individually as it is persisted.
   * A fetch-level failure (auth / rate-limit) fails every account with the same
   * error and rethrows so the caller logs it.
   */
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

    await Promise.all(
      accounts.map((account) => setAccountSyncStatus({ accountId: account.id, status: SyncStatus.SYNCING, userId })),
    );

    const { accessUrl } = await this.getValidatedCredentials(connectionId);
    const apiClient = new SimplefinApiClient(accessUrl);

    // One shared window range covering every account: the earliest `from` any
    // account needs (its latest stored transaction, else an
    // INITIAL_BACKFILL_DAYS backfill). Recently-synced accounts re-fetch a
    // little extra, which dedup drops — the connection is still fetched in
    // one pass per window.
    const to = new Date();
    const plans = await Promise.all(
      accounts.map(async (account) => {
        const anchor = await this.findAnchor({ accountId: account.id, to });
        return {
          account,
          // Anchorless accounts are on their backfill pull, which must not consume plans.
          matchPlanned: anchor !== null,
          createFromDate: anchor ? clampSyncStartToLink({ account, from: anchor }) : subDays(to, INITIAL_BACKFILL_DAYS),
        };
      }),
    );
    const from = new Date(Math.min(...plans.map((plan) => plan.createFromDate.getTime())));

    let byExternalId: Map<string, AccountTransactionsBucket>;
    try {
      byExternalId = await this.fetchAllAccountsTransactions({ connectionId, apiClient, from, to });
    } catch (error) {
      // Fetch-level failure (auth/rate-limit/outage): no account got data, so
      // fail them all with the same message and rethrow for the caller's logger.
      const message = error instanceof Error ? error.message : 'Unknown error';
      await Promise.all(
        accounts.map((account) =>
          setAccountSyncStatus({ accountId: account.id, status: SyncStatus.FAILED, error: message, userId }),
        ),
      );
      throw error;
    }

    for (const { account, matchPlanned, createFromDate } of plans) {
      try {
        if (!account.externalId) {
          throw new BadRequestError({ message: t({ key: 'bankDataProviders.simplefin.accountNoExternalId' }) });
        }

        const bucket = byExternalId.get(account.externalId);
        if (!bucket) {
          // The bridge returned data but omitted this account — usually means
          // the account was disabled at the bank, the conn_id is stale, or the
          // response was truncated. Treat it as a per-account failure so the
          // user sees a real error instead of a "synced, 0 transactions" lie.
          throw new NotFoundError({
            message: t({ key: 'bankDataProviders.simplefin.accountAbsentFromResponse' }),
          });
        }

        const createdIds = await this.persistAccountTransactions({
          connection,
          account,
          transactions: bucket.transactions,
          matchPlanned,
          // The fetched window is the widest any account needs, so each account
          // gates row creation on its own start.
          createFromDate,
        });

        if (bucket.balance != null) {
          await writeBankBalanceWithHistory({
            account,
            balance: Money.fromDecimal(bucket.balance),
          });
        }

        await linkAndEmitSyncedTransactions({
          userId: connection.userId,
          accountId: account.id,
          transactionIds: createdIds,
        });
        logger.info(`[SimpleFIN] Sync: ${createdIds.length} transactions created for account ${account.id}`);

        await setAccountSyncStatus({ accountId: account.id, status: SyncStatus.COMPLETED, userId });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error({ message: `[SimpleFIN] Sync error for account ${account.id}:`, error: error as Error });
        await setAccountSyncStatus({ accountId: account.id, status: SyncStatus.FAILED, error: message, userId });
      }
    }

    await this.updateLastSync(connectionId);
  }

  /**
   * Load transactions for an arbitrary historical window (the account-details
   * "load data for period" picker). SimpleFIN is rate-friendly, so this runs
   * inline; `jobGroupId: null` signals the caller that the work already
   * finished, and `createdCount` reports how many rows were actually created.
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
  }): Promise<{
    jobGroupId: string | null;
    totalBatches: number;
    estimatedMinutes: number;
    createdCount: number;
    fetchedCount: number;
  }> {
    // No `matchPlanned`: a charge from an arbitrary past window must not consume a plan
    // the user made for something else.
    const { transactionIds, fetchedCount } = await this.ingestWithStatus({
      connectionId,
      systemAccountId,
      userId,
      logLabel: 'Period load',
      resolveWindow: async () => ({ from, to }),
    });

    return {
      jobGroupId: null,
      totalBatches: splitIntoWindows(from, to).length,
      estimatedMinutes: 0,
      createdCount: transactionIds.length,
      fetchedCount,
    };
  }

  // ============================================================================
  // Balance Operations
  // ============================================================================

  async fetchBalance(connectionId: string, accountExternalId: string): Promise<ProviderBalance> {
    const { accessUrl } = await this.getValidatedCredentials(connectionId);
    const apiClient = new SimplefinApiClient(accessUrl);

    const accountSet = await this.getAccountsTracked({
      connectionId,
      apiClient,
      params: { accountId: accountExternalId, balancesOnly: true },
    });
    const account = accountSet.accounts.find((acc) => acc.id === accountExternalId);

    if (!account) {
      throw new NotFoundError({ message: t({ key: 'bankDataProviders.simplefin.accountNotFound' }) });
    }

    return {
      amount: Money.fromDecimal(account.balance).toCents(),
      currency: (account.currency || '').toUpperCase(),
      asOf: account['balance-date'] ? new Date(account['balance-date'] * 1000) : new Date(),
    };
  }

  async refreshBalance(connectionId: string, systemAccountId: string): Promise<void> {
    const account = await this.getSystemAccount(systemAccountId);

    if (!account.externalId) {
      throw new BadRequestError({ message: t({ key: 'bankDataProviders.simplefin.accountNoExternalId' }) });
    }

    const balance = await this.fetchBalance(connectionId, account.externalId);
    await writeBankBalanceWithHistory({
      account,
      balance: Money.fromCents(balance.amount),
    });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Shared body for the two inline entry points (incremental sync + explicit
   * period load): mark SYNCING, fetch + persist the window, refresh balance,
   * emit the sync event, and record COMPLETED/FAILED (the FAILED status carries
   * the error message, so rate-limit / auth failures surface to the user).
   */
  private async ingestWithStatus({
    connectionId,
    systemAccountId,
    userId,
    logLabel,
    resolveWindow,
  }: {
    connectionId: string;
    systemAccountId: RecordId;
    userId: number;
    logLabel: string;
    /** Runs inside the tracked work, so a failure while resolving records FAILED. */
    resolveWindow: (params: { account: Accounts }) => Promise<{ from: Date; to: Date; matchPlanned?: boolean }>;
  }): Promise<{ transactionIds: string[]; fetchedCount: number }> {
    const { transactionIds, fetchedCount } = await this.runSyncWithStatus({
      systemAccountId,
      userId,
      connectionId,
      errorLogMessage: `[SimpleFIN] ${logLabel} error:`,
      work: async () => {
        const account = await this.getSystemAccount(systemAccountId);
        const connection = await this.getConnection(connectionId);
        this.validateProviderType(connection);

        if (!account.externalId) {
          throw new BadRequestError({ message: t({ key: 'bankDataProviders.simplefin.accountNoExternalId' }) });
        }

        const { accessUrl } = await this.getValidatedCredentials(connectionId);
        const apiClient = new SimplefinApiClient(accessUrl);

        const { from, to, matchPlanned } = await resolveWindow({ account });

        const ingested = await this.ingestTransactions({
          connectionId,
          apiClient,
          connection,
          account,
          from,
          to,
          matchPlanned,
        });

        if (ingested.balance !== null) {
          await writeBankBalanceWithHistory({
            account,
            balance: Money.fromDecimal(ingested.balance),
          });
        } else {
          logger.info(`[SimpleFIN] ${logLabel}: balance unavailable for account ${account.id}, left unchanged`);
        }

        logger.info(
          `[SimpleFIN] ${logLabel}: ${ingested.createdIds.length} transactions created for account ${account.id}`,
        );

        return { transactionIds: ingested.createdIds, fetchedCount: ingested.fetchedCount };
      },
    });

    return { transactionIds, fetchedCount };
  }

  /**
   * Newest stored transaction time at or before `to`, or null when nothing is stored.
   * A future-dated row must not anchor: it pushes `from` past `to` and every sync becomes a no-op.
   */
  private async findAnchor({ accountId, to }: { accountId: RecordId; to: Date }): Promise<Date | null> {
    const latest = await findOneTransaction({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      where: { accountId, time: { [Op.lte]: to } },
      order: [['time', 'DESC']],
    });

    return latest ? new Date(latest.time) : null;
  }

  /**
   * Fetch posted transactions for one account across [from, to], paging in
   * windows under the SimpleFIN 90-day limit. Pending transactions (posted=0)
   * are dropped — they can change or vanish before settling. Also returns the
   * account's current balance/currency from the response (no extra request).
   * Each window goes through {@link getAccountsTracked}, so auth-failure
   * tracking and error surfacing are consistent across every window.
   */
  private async fetchAccountTransactions({
    connectionId,
    apiClient,
    accountExternalId,
    from,
    to,
  }: {
    connectionId: string;
    apiClient: SimplefinApiClient;
    accountExternalId: string;
    from: Date;
    to: Date;
  }): Promise<{ transactions: SimplefinTransaction[]; balance: string | null; currency: string | null }> {
    const windows = splitIntoWindows(from, to);
    const byId = new Map<string, SimplefinTransaction>();
    let balance: string | null = null;
    let currency: string | null = null;

    for (const window of windows) {
      const accountSet = await this.getAccountsTracked({
        connectionId,
        apiClient,
        params: { accountId: accountExternalId, startDate: window.from, endDate: window.to },
      });
      const account = accountSet.accounts.find((acc) => acc.id === accountExternalId);
      if (!account) {
        // Fail instead of reporting a clean sync with no rows and a null balance.
        // A con.auth entry names the institution the user must re-link at the bridge.
        const conAuthMessages = (accountSet.errlist ?? []).filter((e) => e.code === 'con.auth').map((e) => e.msg);
        throw new NotFoundError({
          message: [t({ key: 'bankDataProviders.simplefin.accountAbsentFromResponse' }), ...conAuthMessages].join(' '),
        });
      }

      balance = account.balance ?? balance;
      currency = account.currency ?? currency;

      for (const tx of account.transactions ?? []) {
        if (tx.pending || !tx.posted) continue; // skip pending (posted === 0)
        byId.set(tx.id, tx);
      }
    }

    return { transactions: [...byId.values()], balance, currency };
  }

  /**
   * Batched counterpart to {@link fetchAccountTransactions}: page [from, to] in
   * windows but WITHOUT the `account` filter, so each `/accounts` call returns
   * EVERY account on the connection (with its nested transactions) in one
   * response. Returns a map keyed by external account id. This collapses an
   * (accounts × windows) request fan-out down to just `windows` requests — the
   * point of the connection-level sync, given SimpleFIN's ~24 requests/day
   * budget. Pending transactions (posted=0) are dropped.
   */
  private async fetchAllAccountsTransactions({
    connectionId,
    apiClient,
    from,
    to,
  }: {
    connectionId: string;
    apiClient: SimplefinApiClient;
    from: Date;
    to: Date;
  }): Promise<Map<string, AccountTransactionsBucket>> {
    const windows = splitIntoWindows(from, to);
    // externalId -> (txId -> tx) so a transaction echoed across overlapping
    // windows is stored once.
    const byAccount = new Map<string, Map<string, SimplefinTransaction>>();
    const meta = new Map<string, { balance: string | null; currency: string | null }>();

    for (const window of windows) {
      const accountSet = await this.getAccountsTracked({
        connectionId,
        apiClient,
        params: { startDate: window.from, endDate: window.to },
      });

      for (const account of accountSet.accounts) {
        if (!byAccount.has(account.id)) byAccount.set(account.id, new Map());
        const txById = byAccount.get(account.id)!;
        for (const tx of account.transactions ?? []) {
          if (tx.pending || !tx.posted) continue; // skip pending (posted === 0)
          txById.set(tx.id, tx);
        }
        meta.set(account.id, {
          balance: account.balance ?? meta.get(account.id)?.balance ?? null,
          currency: account.currency ?? meta.get(account.id)?.currency ?? null,
        });
      }
    }

    const result = new Map<string, AccountTransactionsBucket>();
    for (const [externalId, txById] of byAccount) {
      result.set(externalId, {
        transactions: [...txById.values()],
        balance: meta.get(externalId)?.balance ?? null,
        currency: meta.get(externalId)?.currency ?? null,
      });
    }
    return result;
  }

  /**
   * Fetch + persist transactions for one account over [from, to]. Dedups by
   * `originalId` (primary) and the preserved `externalData.originalSource`
   * (covers the unlink→relink flow). Returns created ids + current balance.
   * Credentials/connection are resolved by the caller and passed in.
   */
  private async ingestTransactions({
    connectionId,
    apiClient,
    connection,
    account,
    from,
    to,
    matchPlanned,
  }: {
    connectionId: string;
    apiClient: SimplefinApiClient;
    connection: BankDataProviderConnections;
    account: Accounts;
    from: Date;
    to: Date;
    matchPlanned?: boolean;
  }): Promise<{ createdIds: string[]; balance: string | null; fetchedCount: number }> {
    const fetched = await this.fetchAccountTransactions({
      connectionId,
      apiClient,
      accountExternalId: account.externalId!,
      from,
      to,
    });

    const createdIds = await this.persistAccountTransactions({
      connection,
      account,
      transactions: fetched.transactions,
      matchPlanned,
      createFromDate: from,
    });

    return { createdIds, balance: fetched.balance, fetchedCount: fetched.transactions.length };
  }

  /**
   * Persist already-fetched SimpleFIN transactions for one account, deduping by
   * `originalId` (primary) and the preserved `externalData.originalSource`
   * (covers the unlink→relink flow). Returns the ids created. The fetch happens
   * in the caller, so this is shared by the per-account path
   * ({@link ingestTransactions}) and the batched connection-level sync
   * ({@link syncConnectionAccounts}).
   */
  private async persistAccountTransactions({
    connection,
    account,
    transactions: rawTransactions,
    matchPlanned = false,
    createFromDate,
  }: {
    connection: BankDataProviderConnections;
    account: Accounts;
    transactions: SimplefinTransaction[];
    matchPlanned?: boolean;
    createFromDate: Date;
  }): Promise<string[]> {
    // Oldest first so balance-history ordering is natural.
    const transactions = rawTransactions.toSorted((a, b) => a.posted - b.posted);
    const defaultCategoryId = await getUserDefaultCategory({ id: connection.userId });
    const createdIds: string[] = [];
    let mergedIntoPlannedCount = 0;
    const checkpoint = this.createBaseCurrencyLockCheckpoint({ userId: connection.userId });

    // One probe per account instead of one per row.
    const canMatchPlanned = matchPlanned && (await accountHasPlannedRows({ accountId: account.id }));

    for (const tx of transactions) {
      await checkpoint();

      // Primary dedup: normal re-sync.
      const existingTx = await findOneTransaction({
        planned: 'exclude',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        where: { accountId: account.id, originalId: tx.id },
        paranoid: false,
      });
      if (existingTx) continue;

      // Secondary dedup: unlink→relink cleared originalId to null but preserved
      // the original value under externalData.originalSource.originalId.
      const existingByOriginalSource = await findOneTransaction({
        planned: 'exclude',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        where: Sequelize.and(
          { accountId: account.id, originalId: null },
          Sequelize.where(Sequelize.literal(`"externalData"#>>'{originalSource,originalId}'`), tx.id),
        ),
        paranoid: false,
      });
      if (existingByOriginalSource) {
        // Restore originalId so future syncs use the fast primary path.
        await existingByOriginalSource.update({ originalId: tx.id });
        continue;
      }

      const time = new Date((tx.transacted_at ?? tx.posted) * 1000);

      // Never create rows before the account's start: that history is already absorbed into the opening balance.
      if (time < createFromDate) continue;

      const amountMoney = Money.fromDecimal(tx.amount);
      const isExpense = amountMoney.toNumber() < 0;

      const createResult = await createTransaction({
        originalId: tx.id,
        note: tx.description || tx.payee || tx.memo || '',
        amount: amountMoney.abs(),
        // `transacted_at` (when it actually happened) beats `posted` (when the
        // bank cleared it) for user-facing date. Falls back to `posted` for
        // bridges/banks that don't expose `transacted_at`.
        time,
        externalData: {
          payee: tx.payee,
          memo: tx.memo,
          sfinAccountId: account.externalId,
          posted: tx.posted,
          transactedAt: tx.transacted_at,
        },
        commissionRate: Money.fromCents(0),
        cashbackAmount: Money.fromCents(0),
        accountId: account.id,
        userId: connection.userId,
        transactionType: isExpense ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
        paymentType: PAYMENT_TYPES.bankTransfer,
        categoryId: defaultCategoryId,
        transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
        accountType: ACCOUNT_TYPES.simplefin,
        rawMerchantName: tx.payee?.trim() || null,
        matchPlanned: canMatchPlanned,
      });

      // A merged row is not a new row: it keeps the user's category and payee, which the
      // post-sync listeners on the emitted ids would overwrite.
      if (createResult.mergedIntoPlanned) {
        mergedIntoPlannedCount += 1;
      } else {
        createdIds.push(createResult[0].id);
      }
    }

    if (mergedIntoPlannedCount > 0) {
      logger.info(`[SimpleFIN] ${mergedIntoPlannedCount} planned transaction(s) confirmed for account ${account.id}`);
      await notifyPlannedConfirmations({
        userId: connection.userId,
        accountId: account.id,
        mergedCount: mergedIntoPlannedCount,
      });
    }

    return createdIds;
  }

  /**
   * Call `/accounts` with shared auth-failure tracking and error surfacing:
   * surface any returned `errlist`/`errors`, reset the failure counter on a
   * clean success, and route auth failures into the deactivation logic. Every
   * authenticated read goes through here so tracking can't drift between code
   * paths.
   */
  private async getAccountsTracked({
    connectionId,
    apiClient,
    params,
  }: {
    connectionId: string;
    apiClient: SimplefinApiClient;
    params?: SimplefinGetAccountsParams;
  }): Promise<SimplefinAccountSet> {
    try {
      const accountSet = await apiClient.getAccounts(params);
      this.surfaceAccountSetErrors(accountSet);
      await this.resetAuthFailures(connectionId);
      return accountSet;
    } catch (error) {
      // Rate-limit (TooManyRequests) is NOT a ForbiddenError, so isAuthError
      // returns false and the connection is not deactivated for a transient
      // throttle — the error still propagates and surfaces via the sync status.
      await this.handleAuthError({ connectionId, error });
      throw error;
    }
  }

  /**
   * Logs every bridge error and throws ForbiddenError only for gen.auth, the one code meaning
   * our Access URL is rejected. con.auth and other entries leave the returned accounts processable.
   */
  private surfaceAccountSetErrors(accountSet: SimplefinAccountSet): void {
    const structured = accountSet.errlist ?? [];
    const legacy = accountSet.errors ?? [];

    for (const err of structured) {
      // gen.auth is re-link churn already surfaced by the ForbiddenError; con.auth is the
      // user's bank asking them to re-authenticate. Neither is an app fault, so both stay out of Sentry.
      const log = SIMPLEFIN_EXPECTED_AUTH_CODES.has(err.code) ? logger.info : logger.warn;
      log(`[SimpleFIN] Bridge error ${err.code}: ${err.msg}`);
    }
    for (const msg of legacy) {
      logger.warn(`[SimpleFIN] Bridge warning: ${msg}`);
    }

    const authErrors = structured.filter((e) => e.code === 'gen.auth');
    if (authErrors.length > 0) {
      throw new ForbiddenError({
        message: authErrors.map((e) => e.msg).join('; ') || t({ key: 'bankDataProviders.simplefin.invalidAccessUrl' }),
      });
    }
  }

  /** Index the protocol-v2 `connections` array by `conn_id` for org lookups. */
  private buildConnectionsMap(accountSet: SimplefinAccountSet): Map<string, SimplefinConnection> {
    return new Map((accountSet.connections ?? []).map((connection) => [connection.conn_id, connection]));
  }

  /**
   * Resolve an account's institution/org details, tolerating both protocol
   * versions: v1 embeds an `org` block on the account; v2 moves it to the
   * top-level `connections` array (referenced by `conn_id`).
   */
  private resolveOrg(
    account: SimplefinAccount,
    connectionsById: Map<string, SimplefinConnection>,
  ): { name?: string; sfinUrl?: string; domain?: string } {
    const connection = account.conn_id ? connectionsById.get(account.conn_id) : undefined;
    return {
      name: account.org?.name ?? connection?.name,
      sfinUrl: account.org?.['sfin-url'] ?? connection?.['sfin-url'],
      domain: account.org?.domain ?? this.domainFromUrl(connection?.org_url),
    };
  }

  /** v2 carries no bare domain — derive it from the connection's org_url. */
  private domainFromUrl(url?: string): string | undefined {
    if (!url) return undefined;
    try {
      return new URL(url).hostname;
    } catch {
      return undefined;
    }
  }

  private isIsoCurrency(code: string): boolean {
    return /^[A-Z]{3}$/.test(code);
  }

  private isValidConnectInput(credentials: unknown): credentials is SimplefinConnectInput {
    if (typeof credentials !== 'object' || credentials === null || !('setupToken' in credentials)) {
      return false;
    }
    const { setupToken } = credentials as Record<string, unknown>;
    return typeof setupToken === 'string' && setupToken.length > 0;
  }

  private isValidStoredCredentials(credentials: unknown): credentials is SimplefinCredentials {
    if (typeof credentials !== 'object' || credentials === null || !('accessUrl' in credentials)) {
      return false;
    }
    const { accessUrl } = credentials as Record<string, unknown>;
    return typeof accessUrl === 'string' && accessUrl.length > 0;
  }

  private async getValidatedCredentials(connectionId: string): Promise<SimplefinCredentials> {
    const credentials = await this.getDecryptedCredentials(connectionId);
    if (!this.isValidStoredCredentials(credentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.simplefin.invalidCredentialsFormat' }) });
    }
    return credentials;
  }
}

import type { RecordId } from '@bt/shared/types';
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ACCOUNT_TYPES,
  BANK_PROVIDER_TYPE,
  DEACTIVATION_REASON,
  NO_CURRENCY_CODE,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { roundHalfToEven } from '@common/utils/round-half-to-even';
import { t } from '@i18n/index';
import { BadRequestError, ForbiddenError, NotFoundError, ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import {
  countTransactions,
  findOneTransaction,
  findTransactions,
  updateTransactions,
} from '@models/transactions-query';
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
import { getExchangeRate } from '@services/user-exchange-rate/get-exchange-rate.service';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import { addDays, subDays } from 'date-fns';
import { Op, Sequelize } from 'sequelize';

import { encryptCredentials } from '../utils/credential-encryption';
import { notifyPlannedConfirmations } from '../utils/notify-planned-confirmations';
import { writeBankBalanceWithHistory } from '../utils/write-bank-balance-with-history';
import { EnableBankingApiClient, isAspspDateRangeRejection } from './api-client';
import {
  AmountType,
  CreditDebitIndicator,
  EnableBankingAccount,
  EnableBankingConnectionParams,
  EnableBankingCredentials,
  EnableBankingMetadata,
  OAuthCallbackParams,
  PSUType,
  StartAuthorizationResponse,
  TransactionStatus,
} from './types';
import { balancesForLog, pickAccountBalance } from './utils/balances';
import { filterIbanCompatible, haveSameParties, pickNearestByDate } from './utils/candidate-selection';
import { calculateConsentValidUntil } from './utils/consent';
import {
  FINGERPRINT_WINDOW_DAYS,
  INITIAL_SYNC_FALLBACK_DAYS,
  MS_PER_DAY,
  PENDING_UPGRADE_WINDOW_DAYS,
} from './utils/constants';
import { type ClosingBalanceRow, findClosingRowId } from './utils/daily-closing-balance';
import { generateState, validatePrivateKey, validateState } from './utils/jwt-utils';
import { type EditMergeSkipReason, hasManualStamp, planEditMerge } from './utils/plan-edit-merge';
import { generateTransactionHash, getTransactionDateString } from './utils/transaction-hash';
import {
  cleanMerchantName,
  deriveNoteFromRaw,
  getBookingDate,
  getCounterpartyIban,
  getEntryReference,
  getRawTransaction,
  getRawTransactionStatus,
  getReferenceNumber,
  hasSettledStatus,
  isBookedCanonical,
  isNonLedgerStatus,
  isPreBookingRow,
  isPreBookingStatus,
  isRevokedStatus,
  parseBookingDay,
  syncGeneratedNote,
  toEditMergeSide,
  whereNoEntryReference,
  wherePreBookingStatus,
  withoutUndefinedValues,
} from './utils/transaction-metadata';

type ReconcileSkipReason = EditMergeSkipReason | 'dependent_rows' | 'categorization_conflict';

const getRedirectUrl = () => process.env.ENABLE_BANKING_REDIRECT_URL || 'http://localhost:8100/bank-callback';

/**
 * Enable Banking provider implementation
 * Handles integration with Enable Banking API for multi-bank account access across Europe
 * Supports 6000+ banks via PSD2
 */
export class EnableBankingProvider extends BaseBankDataProvider {
  readonly metadata: ProviderMetadata = {
    get redirectUrl() {
      return getRedirectUrl();
    },
    type: BANK_PROVIDER_TYPE.ENABLE_BANKING,
    name: 'Enable Banking',
    description: 'Access 6000+ European banks via PSD2 open banking',
    features: {
      supportsWebhooks: false,
      supportsRealtime: false,
      requiresReauth: true, // Sessions expire after consent period
      supportsManualSync: true,
      supportsAutoSync: true,
      defaultSyncInterval: 24 * 60 * 60 * 1000, // 24 hours
      minSyncInterval: 5 * 60 * 1000, // 5 minutes
    },
  };

  // ============================================================================
  // Connection Management
  // ============================================================================

  /**
   * Start connection flow - returns authorization URL for user
   * Full connection is completed via handleOAuthCallback()
   */
  async connect(userId: number, credentials: unknown): Promise<string> {
    if (!this.isValidConnectionParams(credentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.enableBanking.invalidCredentialsFormat' }) });
    }

    const { appId, privateKey, bankName, bankCountry, redirectUrl, maxConsentValidity } = credentials;

    // Validate private key format
    if (!validatePrivateKey(privateKey)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.enableBanking.invalidRsaKey' }) });
    }

    // Create initial credentials object (without session yet)
    const initialCredentials: EnableBankingCredentials = {
      appId,
      privateKey,
    };

    // Test connection to Enable Banking API
    const apiClient = new EnableBankingApiClient(initialCredentials);
    const isValid = await this.validateCredentials(initialCredentials);
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.enableBanking.invalidCredentials' }) });
    }

    // Generate OAuth state for CSRF protection
    const state = generateState(userId);

    // Calculate consent validity period
    const consentValidFrom = new Date();
    const consentValidUntil = calculateConsentValidUntil({ bankMaxConsentValidity: maxConsentValidity });

    // Start authorization flow
    const authResponse = await this.startAuthorizationFlow(
      apiClient,
      bankName,
      bankCountry,
      redirectUrl || getRedirectUrl(),
      state,
      consentValidUntil,
    );

    // Create pending connection in database
    const connection = await BankDataProviderConnections.create({
      userId,
      providerType: this.metadata.type,
      providerName: `${bankName} (${bankCountry})`,
      isActive: false, // Will be activated after OAuth callback
      credentials: encryptCredentials({
        appId,
        privateKey,
        authorizationId: authResponse.authorization_id,
      }),
      metadata: {
        bankName,
        bankCountry,
        state,
        authUrl: authResponse.url,
        consentValidFrom: consentValidFrom.toISOString(),
        consentValidUntil: consentValidUntil.toISOString(),
        bankMaxConsentValidity: maxConsentValidity,
      } as EnableBankingMetadata,
    } as any);

    // Store auth URL in connection for retrieval
    // Return both connection ID and auth URL (frontend needs URL)
    return connection.id;
  }

  /**
   * Get authorization URL for a pending connection
   * Used by frontend to redirect user to bank
   */
  async getAuthorizationUrl(connectionId: string): Promise<string> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    const metadata = connection.metadata as unknown as EnableBankingMetadata;

    if (!metadata.authUrl) {
      throw new BadRequestError({ message: t({ key: 'bankDataProviders.enableBanking.authUrlNotFound' }) });
    }

    return metadata.authUrl;
  }

  /**
   * Complete OAuth flow after user authorization
   * Should be called from callback endpoint
   */
  async handleOAuthCallback(connectionId: string, callbackParams: OAuthCallbackParams): Promise<void> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    const metadata = connection.metadata as unknown as EnableBankingMetadata;

    // Validate state parameter
    if (!metadata.state || callbackParams.state !== metadata.state) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.enableBanking.invalidOAuthState' }) });
    }

    if (!validateState(callbackParams.state, connection.userId)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.enableBanking.oAuthStateExpired' }) });
    }

    // Check for OAuth errors
    if (callbackParams.error) {
      throw new BadRequestError({
        message: t({
          key: 'bankDataProviders.enableBanking.oAuthAuthorizationFailed',
          variables: { error: callbackParams.error_description || callbackParams.error },
        }),
      });
    }

    // Get credentials
    const credentials = (await this.getDecryptedCredentials(connectionId)) as unknown as EnableBankingCredentials;
    const apiClient = new EnableBankingApiClient(credentials);

    // Exchange code for session
    const sessionResponse = await apiClient.createSession({
      code: callbackParams.code,
    });

    // Update connection with session info
    credentials.sessionId = sessionResponse.session_id;
    connection.setEncryptedCredentials(credentials as unknown as Record<string, unknown>);

    // Calculate consent validity - consent is now active after successful OAuth
    const consentValidFrom = new Date();
    const consentValidUntil = calculateConsentValidUntil({ bankMaxConsentValidity: metadata.bankMaxConsentValidity });

    // Update metadata with account summaries and consent dates
    // Store all accounts including those without uid (blocked/closed accounts)
    // UI can check uid to show appropriate warnings
    const updatedMetadata: EnableBankingMetadata = {
      ...metadata,
      accounts: sessionResponse.accounts.map((account) => ({
        identification_hash: account.identification_hash,
        uid: account.uid,
        iban: account.account_id?.iban,
        currency: account.currency,
        name: account.name || account.owner_name,
      })),
      state: undefined, // Clear state after successful auth
      consentValidFrom: consentValidFrom.toISOString(),
      consentValidUntil: consentValidUntil.toISOString(),
      // Clear the "needs reauth" markers – successful OAuth means the prior
      // auth failure is resolved. Without this, the connection would still
      // appear in `connectionsNeedingReauth` whenever it's later marked
      // inactive for any reason (manual disconnect, future failure path).
      deactivationReason: null,
      consecutiveAuthFailures: 0,
    };
    connection.metadata = updatedMetadata;
    connection.isActive = true;

    await connection.save();

    // Update externalId for existing accounts after reconnection
    // Enable Banking assigns new UUIDs after each authorization, but IBAN stays the same
    await this.updateExistingAccountExternalIds({
      connectionId,
      userId: connection.userId,
      newAccounts: sessionResponse.accounts,
    });
  }

  /**
   * Update existing accounts after reconnection.
   * Enable Banking assigns new UIDs after each authorization, but identification_hash stays the same.
   * This method:
   * 1. Matches accounts by IBAN + currency
   * 2. Updates externalData with new rawAccountData and uid (for API calls)
   * 3. Migrates transaction hashes if externalId changes (from old uid to identification_hash)
   * 4. Updates externalId to identification_hash (stable across sessions)
   */
  private async updateExistingAccountExternalIds({
    connectionId,
    userId,
    newAccounts,
  }: {
    connectionId: string;
    userId: number;
    newAccounts: EnableBankingAccount[];
  }): Promise<void> {
    // Get existing accounts for this connection
    const existingAccounts = await Accounts.findAll({
      where: {
        userId,
        bankDataProviderConnectionId: connectionId,
      },
    });

    if (existingAccounts.length === 0) {
      return; // No existing accounts to update
    }

    // Match and update existing accounts
    for (const existingAccount of existingAccounts) {
      const existingMetadata = existingAccount.externalData as Record<string, unknown> | null;
      const existingIban = existingMetadata?.iban as string | undefined;

      // Primary: match by identification_hash (externalId now stores this stable ID)
      let matchingNewAccount = newAccounts.find((newAcc) => newAcc.identification_hash === existingAccount.externalId);

      // Fallback: match by IBAN + currency (for legacy accounts where externalId was uid)
      if (!matchingNewAccount && existingIban) {
        matchingNewAccount = newAccounts.find(
          (newAcc) => newAcc.account_id?.iban === existingIban && newAcc.currency === existingAccount.currencyCode,
        );
      }

      if (!matchingNewAccount) {
        // No match found - account needs to be re-linked by user
        logger.warn(
          `Could not match existing account ${existingAccount.id} (${existingAccount.name}, ${existingAccount.currencyCode}). ` +
            `Account needs to be re-linked.`,
        );
        continue;
      }

      // The stable identifier we should use for externalId
      const newExternalId = matchingNewAccount.identification_hash;

      // Update externalData with fresh account data (including uid for API calls)
      const updatedMetadata = {
        ...existingMetadata,
        iban: matchingNewAccount.account_id?.iban,
        product: matchingNewAccount.product,
        ownerName: matchingNewAccount.owner_name,
        accountServicer: matchingNewAccount.account_servicer?.name,
        bic: matchingNewAccount.account_servicer?.bic_fi,
        uid: matchingNewAccount.uid, // Session-specific uid for API calls
        rawAccountData: matchingNewAccount, // Full account data
      };

      // Check if we need to migrate transaction hashes
      // This happens when externalId was previously set to uid (old behavior)
      // and now we're updating it to identification_hash (new stable identifier)
      if (existingAccount.externalId !== newExternalId) {
        await this.migrateTransactionHashes({
          account: existingAccount,
          newExternalId,
        });
        // Reload to get updated externalId
        await existingAccount.reload();
      }

      // Update externalData (always update to get fresh uid and rawAccountData)
      await existingAccount.update({
        externalData: updatedMetadata,
      });
    }
  }

  /**
   * Reauthorize an existing connection (renew consent without disconnecting)
   * Returns the new authorization URL for user to complete OAuth flow
   */
  async reauthorize(connectionId: string): Promise<string> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    const metadata = connection.metadata as unknown as EnableBankingMetadata;
    const credentials = (await this.getDecryptedCredentials(connectionId)) as unknown as EnableBankingCredentials;

    // A backup restore leaves an empty-credentials stub (no appId/privateKey) so the
    // ciphertext never travels between instances. The renew path below signs a JWT with
    // those keys and would crash on the stub; route it to a full reconnect instead.
    if (!this.isValidCredentials(credentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.enableBanking.invalidStoredCredentials' }) });
    }

    if (!metadata.bankName || !metadata.bankCountry) {
      throw new BadRequestError({ message: t({ key: 'bankDataProviders.enableBanking.bankInfoNotFound' }) });
    }

    // Mark connection as inactive IMMEDIATELY before any API calls
    // Once reauthorization starts, the old session becomes invalid at Enable Banking's side
    // Set consent end date to now so UI shows as expired with 0 days remaining
    const now = new Date().toISOString();
    connection.isActive = false;
    const expiredMetadata: EnableBankingMetadata = {
      ...metadata,
      consentValidUntil: now, // Expired now - UI will show 0 days remaining
    };
    connection.metadata = expiredMetadata as any;
    await connection.save();

    // Revoke existing session if it exists
    if (credentials.sessionId) {
      try {
        const apiClient = new EnableBankingApiClient(credentials);
        await apiClient.deleteSession(credentials.sessionId);
      } catch (error) {
        // Log but continue - session might already be expired
        logger.error(
          { message: 'Failed to revoke existing Enable Banking session during reauthorization', error: error as Error },
          { connectionId },
        );
      }
    }

    // Generate new OAuth state
    const state = generateState(connection.userId);

    // Calculate consent validity period for the API request
    // The actual consent dates will be set in handleOAuthCallback() after OAuth completes
    const consentValidUntil = calculateConsentValidUntil({
      bankMaxConsentValidity: expiredMetadata.bankMaxConsentValidity,
    });

    // Create API client with existing credentials
    const apiClient = new EnableBankingApiClient(credentials);

    // Start new authorization flow
    const authResponse = await this.startAuthorizationFlow(
      apiClient,
      metadata.bankName,
      metadata.bankCountry,
      getRedirectUrl(),
      state,
      consentValidUntil,
    );

    // Update connection credentials with new authorization ID, remove old session
    credentials.authorizationId = authResponse.authorization_id;
    credentials.sessionId = undefined;
    connection.setEncryptedCredentials(credentials as unknown as Record<string, unknown>);

    // Update metadata with new auth info
    // Note: consent dates are intentionally NOT set here - they should only be set
    // after OAuth completes successfully in handleOAuthCallback()
    const updatedMetadata: EnableBankingMetadata = {
      ...expiredMetadata, // Use cleared metadata (without consent dates)
      state,
      authUrl: authResponse.url,
    };
    connection.metadata = updatedMetadata;

    await connection.save();

    return authResponse.url;
  }

  async disconnect(connectionId: string): Promise<void> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    // Try to revoke session at Enable Banking
    try {
      const credentials = (await this.getDecryptedCredentials(connectionId)) as unknown as EnableBankingCredentials;
      if (credentials.sessionId) {
        const apiClient = new EnableBankingApiClient(credentials);
        await apiClient.deleteSession(credentials.sessionId);
      }
    } catch (error) {
      // Log error but continue with disconnection
      logger.error(
        { message: 'Failed to revoke Enable Banking session on disconnect', error: error as Error },
        { connectionId },
      );
    }

    // Delete the connection (CASCADE will handle related accounts)
    await connection.destroy();
  }

  async validateCredentials(credentials: unknown): Promise<boolean> {
    if (!this.isValidCredentials(credentials)) {
      return false;
    }

    const { appId, privateKey } = credentials;

    // Validate private key format
    if (!validatePrivateKey(privateKey)) {
      return false;
    }

    const apiClient = new EnableBankingApiClient({ appId, privateKey });

    // testConnection returns false only for 401/403.
    // Network/5xx errors propagate so callers can distinguish "invalid creds"
    // from "provider is down".
    return await apiClient.testConnection();
  }

  async refreshCredentials(connectionId: string, newCredentials: unknown): Promise<void> {
    if (!this.isValidCredentials(newCredentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.enableBanking.invalidCredentialsFormat' }) });
    }

    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    // Validate new credentials
    const isValid = await this.validateCredentials(newCredentials);
    if (!isValid) {
      throw new ForbiddenError({ message: t({ key: 'bankDataProviders.enableBanking.invalidCredentials' }) });
    }

    // Get existing session ID if any
    const existingCreds = (await this.getDecryptedCredentials(connectionId)) as unknown as EnableBankingCredentials;

    // Update credentials while preserving session
    const updatedCredentials: EnableBankingCredentials = {
      ...(newCredentials as EnableBankingCredentials),
      sessionId: existingCreds.sessionId,
    };

    connection.setEncryptedCredentials(updatedCredentials as unknown as Record<string, unknown>);
    await connection.save();
  }

  // ============================================================================
  // Account Operations
  // ============================================================================

  async fetchAccounts(connectionId: string): Promise<ProviderAccount[]> {
    const connection = await this.getConnection(connectionId);
    this.validateProviderType(connection);

    const credentials = await this.getValidatedCredentials(connectionId);

    if (!credentials.sessionId) {
      throw new BadRequestError({ message: t({ key: 'bankDataProviders.enableBanking.noActiveSession' }) });
    }

    try {
      const apiClient = new EnableBankingApiClient(credentials);
      const session = await apiClient.getSession(credentials.sessionId);

      // Fetch all account details and balances in parallel
      const accountsData = await Promise.all(
        session.accounts.map(async (accountId) => {
          const [details, balances] = await Promise.all([
            apiClient.getAccountDetails(accountId),
            apiClient.getAccountBalances(accountId),
          ]);

          const primaryBalance = pickAccountBalance({ balances });

          logger.info('[balance-diag] Enable Banking fetchAccounts balances', {
            connectionId,
            userId: connection.userId,
            selectedType: primaryBalance?.balance_type ?? null,
            balances: balancesForLog({ balances }),
          });

          // Convert balance from string to system amount (cents as integer)
          const balanceFloat = primaryBalance?.balance_amount ? parseFloat(primaryBalance.balance_amount.amount) : 0;
          const balanceSystemAmount = Money.fromDecimal(balanceFloat).toCents();
          const creditLimitCurrencyMatches = Boolean(
            details.currency &&
            details.credit_limit?.currency &&
            details.credit_limit.currency.toUpperCase() === details.currency.toUpperCase(),
          );
          const creditLimitFloat = parseFloat(details.credit_limit?.amount ?? '');
          const creditLimitCents =
            creditLimitCurrencyMatches && Number.isFinite(creditLimitFloat) && creditLimitFloat > 0
              ? Money.fromDecimal(creditLimitFloat).toCents()
              : 0;
          if (details.credit_limit && (!creditLimitCurrencyMatches || !Number.isFinite(creditLimitFloat))) {
            logger.info(
              creditLimitCurrencyMatches
                ? 'Enable Banking credit limit ignored: unparsable amount'
                : 'Enable Banking credit limit ignored: currency mismatch',
              {
                connectionId,
                identificationHash: details.identification_hash,
                creditLimit: details.credit_limit,
              },
            );
          }

          return {
            externalId: details.identification_hash,
            name:
              details.name ||
              details.details ||
              details.product ||
              `Account ${details.account_id?.iban?.slice(-4) || accountId.slice(-4)}`,
            type: 'debit' as const, // Enable Banking doesn't distinguish, default to debit
            balance: balanceSystemAmount,
            // Empty/missing currency → ISO "XXX" (no currency), so connect
            // requires an explicit user choice instead of failing downstream.
            currency: details.currency?.toUpperCase() || NO_CURRENCY_CODE,
            metadata: {
              creditLimit: creditLimitCents,
              iban: details.account_id?.iban,
              product: details.product,
              ownerName: details.owner_name,
              accountServicer: details.account_servicer?.name,
              bic: details.account_servicer?.bic_fi,
              // Store the session-specific uid for API calls (balances, transactions)
              uid: details.uid,
              // Store complete raw payload for future reference and migrations
              rawAccountData: details,
            },
          };
        }),
      );

      return accountsData;
    } catch (error) {
      return this.handleProviderError({ error, connectionId });
    }
  }

  // ============================================================================
  // Transaction Operations
  // ============================================================================

  /**
   * Fetch transactions from Enable Banking API
   * @param connectionId - Connection ID
   * @param accountApiUid - Session-specific uid for API calls
   * @param dateRange - Optional date range filter
   * @param accountExternalIdForHash - Stable identifier for hash generation (defaults to accountApiUid for backward compatibility)
   */
  async fetchTransactions(
    connectionId: string,
    accountApiUid: string,
    dateRange?: DateRange,
    accountExternalIdForHash?: string,
  ): Promise<ProviderTransaction[]> {
    const credentials = await this.getValidatedCredentials(connectionId);

    if (!credentials.sessionId) {
      throw new BadRequestError({ message: t({ key: 'bankDataProviders.enableBanking.noActiveSessionGeneric' }) });
    }

    const apiClient = new EnableBankingApiClient(credentials);

    // Use the stable externalId for hashing (identification_hash), or fall back to apiUid for backward compatibility
    const hashId = accountExternalIdForHash || accountApiUid;

    // Get all transactions for the date range
    const transactions = await apiClient.getAllTransactions(accountApiUid, {
      date_from: dateRange?.from?.toISOString().split('T')[0],
      date_to: dateRange?.to?.toISOString().split('T')[0],
    });

    // Cancelled, rejected and scheduled payments are not spendable money and must
    // never reach the ledger. CNCL/RJCT still travel on, because the sync matcher
    // needs them to remove a row stored while the payment was still pending.
    const excludedByStatus = new Map<TransactionStatus, number>();
    const importable = transactions.filter((tx) => {
      if (!isNonLedgerStatus({ status: tx.status })) return true;
      excludedByStatus.set(tx.status, (excludedByStatus.get(tx.status) ?? 0) + 1);
      return isRevokedStatus({ status: tx.status });
    });

    if (excludedByStatus.size > 0) {
      const breakdown = [...excludedByStatus].map(([status, count]) => `${status}=${count}`).join(' ');
      logger.info(`Enable Banking fetch: ${breakdown} payload(s) excluded from the ledger`, { connectionId });
    }

    return importable.map((tx) => {
      const isExpense = tx.credit_debit_indicator === CreditDebitIndicator.DBIT;
      const amountFloat = parseFloat(tx.transaction_amount.amount);
      const amountSystemAmount = Money.fromDecimal(amountFloat).toCents();
      const merchantName = (isExpense ? tx.creditor?.name : tx.debtor?.name) || 'Unknown';

      // Generate unique hash from transaction data
      // Use stable externalId (identification_hash) for hashing, not session-specific uid
      const uniqueId = generateTransactionHash({ tx, accountExternalId: hashId });

      // Get the transaction date using priority-based selection
      const transactionDateString = getTransactionDateString({ tx });
      const transactionDate = transactionDateString ? new Date(transactionDateString) : new Date();

      return {
        externalId: uniqueId,
        amount: amountSystemAmount,
        currency: tx.transaction_amount.currency,
        date: transactionDate,
        description: deriveNoteFromRaw({ rawTransaction: tx }),
        merchantName,
        metadata: {
          // Parsed/extracted fields for easy access
          transactionDate: tx.transaction_date,
          valueDate: tx.value_date,
          bookingDate: tx.booking_date,
          debtorName: tx.debtor?.name || null,
          debtorAccount: tx.debtor_account?.iban,
          creditorName: tx.creditor?.name || null,
          creditorAccount: tx.creditor_account?.iban,
          balanceAfter: tx.balance_after_transaction,
          oritinalAmount: parseFloat(tx.transaction_amount.amount),
          isExpense, // Store transaction type indicator
          entryReference: tx.entry_reference,
          referenceNumber:
            typeof tx.reference_number === 'string' ? tx.reference_number : tx.reference_number?.identification,
          originalTransactionId: tx.transaction_id, // Store if available

          // Store complete raw payload for future reference and debugging
          rawTransaction: tx,
        },
      };
    });
  }

  /**
   * Sync transactions for an account (direct sync, no queue)
   */
  async syncTransactions({
    connectionId,
    systemAccountId,
    userId,
  }: {
    connectionId: string;
    systemAccountId: RecordId;
    userId: number;
  }): Promise<void> {
    try {
      await this.runSyncWithStatus({
        systemAccountId,
        userId,
        connectionId,
        errorLogMessage: 'Enable Banking sync error',
        work: async () => {
          const account = await this.getSystemAccount(systemAccountId);
          const connection = await this.getConnection(connectionId);
          this.validateProviderType(connection);

          if (!account.externalId) {
            throw new BadRequestError({ message: t({ key: 'accounts.accountNoExternalIdEnableBanking' }) });
          }

          // Get metadata for API calls and migrations
          let metadata = account.externalData as Record<string, unknown> | null;
          let rawAccountData = metadata?.rawAccountData as EnableBankingAccount | undefined;

          // Check if we need to refresh account metadata from the API
          // This happens for accounts created before rawAccountData/uid were stored
          const needsMetadataRefresh = !rawAccountData || !metadata?.uid;

          if (needsMetadataRefresh) {
            logger.info(`Account ${account.id} is missing rawAccountData or uid, refreshing from API...`);
            const freshAccountData = await this.refreshAccountMetadata({ connectionId, account });
            if (freshAccountData) {
              // Reload account to get updated externalData
              await account.reload();
              metadata = account.externalData as Record<string, unknown> | null;
              rawAccountData = metadata?.rawAccountData as EnableBankingAccount | undefined;
            }
          }

          // Get uid from metadata for API calls (session-specific)
          // Fall back to externalId for backward compatibility
          const apiUid = (metadata?.uid as string) || account.externalId;

          // Check if we need to migrate transaction hashes
          // This happens when account was created with uid as externalId but now has identification_hash available
          if (rawAccountData?.identification_hash && account.externalId !== rawAccountData.identification_hash) {
            await this.migrateTransactionHashes({
              account,
              newExternalId: rawAccountData.identification_hash,
            });
            // Reload account to get updated externalId
            await account.reload();
          }

          // Find the most recent transaction
          const latestTransaction = await findOneTransaction({
            planned: 'exclude',
            access: 'unscoped-internal',
            balanceAdjustments: 'include',
            where: { accountId: account.id },
            order: [['time', 'DESC']],
          });

          const to = new Date();

          // Incremental: `from` anchored to last tx, pulled back to the oldest payment the
          // previous sync saw pending. That payment books under its original date, so a
          // newer stored row must not push it out of range.
          // Initial: no anchor, must negotiate window with bank.
          // Anchor capped at `to`: it is a MAX over every row on the account, so one
          // future-dated entry – a value_date past today – would ask for a date_from
          // the bank rejects on every sync.
          const storedOldestPendingDate = account.externalData?.oldestPendingDate;
          // A bank may stop listing a payment as pending before it lists the booked copy,
          // so the stored pending row keeps the range open too. Older rows are skipped:
          // their booked copy could no longer upgrade them.
          const oldestStoredPendingRow = latestTransaction
            ? await findOneTransaction({
                planned: 'exclude',
                access: 'unscoped-internal',
                balanceAdjustments: 'include',
                where: {
                  accountId: account.id,
                  time: { [Op.gte]: new Date(to.getTime() - PENDING_UPGRADE_WINDOW_DAYS * MS_PER_DAY) },
                  [Op.and]: [wherePreBookingStatus()],
                },
                order: [['time', 'ASC']],
              })
            : null;
          const fetchedTransactions = latestTransaction
            ? await this.fetchTransactions(
                connectionId,
                apiUid,
                {
                  from: new Date(
                    Math.min(
                      latestTransaction.time.getTime(),
                      to.getTime(),
                      (typeof storedOldestPendingDate === 'string' && Date.parse(storedOldestPendingDate)) || Infinity,
                      oldestStoredPendingRow?.time.getTime() ?? Infinity,
                    ),
                  ),
                  to,
                },
                account.externalId,
              )
            : await this.fetchInitialTransactionsWithShrinkingWindow({
                connectionId,
                apiUid,
                accountExternalId: account.externalId,
                accountId: account.id,
                to,
              });

          // oxlint-disable-next-line unicorn/consistent-function-scoping
          const isPendingPayload = (tx: ProviderTransaction) =>
            isPreBookingStatus({ status: getRawTransactionStatus({ externalData: tx.metadata }) });
          const pendingTimes = fetchedTransactions.filter(isPendingPayload).map((tx) => tx.date.getTime());
          const oldestPendingDate =
            pendingTimes.length > 0 ? new Date(Math.min(...pendingTimes)).toISOString() : undefined;

          // A skipped pending payload returns as BOOK on a later sync. Rows stored while
          // the setting was on still get booked or revoked through the matcher below.
          const { importPendingBankTransactions } = await getUserSettings({ userId: connection.userId });
          const providerTransactions = importPendingBankTransactions
            ? fetchedTransactions
            : fetchedTransactions.filter((tx) => !isPendingPayload(tx));

          // Sort transactions by date (ascending) so the last transaction for each day
          // will have the correct end-of-day balance in balance_after_transaction.
          // This is important for Balances.handleTransactionChange() which uses the
          // balance from the last-processed transaction for each date.
          // Within one date pre-booking rows come first: when a batch carries both
          // copies of the same purchase, the pending row must already exist for the
          // booked copy to upgrade it, otherwise both land as separate rows. It also
          // puts a cancellation after the payload that stored the row it removes.
          const pendingFirstRank = (tx: ProviderTransaction) => (isPendingPayload(tx) ? 0 : 1);
          providerTransactions.sort(
            (a, b) => a.date.getTime() - b.date.getTime() || pendingFirstRank(a) - pendingFirstRank(b),
          );

          // Process each transaction and collect created/updated transaction IDs
          const createdTransactionIds: string[] = [];
          // Rows the bank booked this run: auto-link eligible, but not new, so they must not be re-emitted.
          const bookedUpgradedTransactionIds: string[] = [];
          let updatedCount = 0;
          const mergedPlannedIds: string[] = [];
          // Only the incremental branch may confirm a plan: the initial history fetch
          // reaches years back, where a same-amount charge would eat an unrelated plan.
          const matchPlanned = Boolean(latestTransaction) && (await accountHasPlannedRows({ accountId: account.id }));
          // Tier 4 costs one extra query per unmatched row, and on an initial 3-year
          // sync every row is unmatched. Flips to true as soon as this run stores a
          // pending row so a same-batch booked copy can still upgrade it.
          let accountHasPendingRows = await this.accountHasPendingRows({ accountId: account.id });
          const ownAccountIds = [
            metadata?.iban,
            rawAccountData?.account_id?.iban,
            rawAccountData?.account_id?.other?.identification,
          ].filter((id): id is string => typeof id === 'string' && id !== '');
          let stalePendingIgnoredCount = 0;
          let revokedRemovedCount = 0;
          let revokedKeptCount = 0;
          let softDeletedSkippedCount = 0;
          const checkpoint = this.createBaseCurrencyLockCheckpoint({ userId });

          for (const tx of providerTransactions) {
            await checkpoint();

            let existingTx = await this.findExistingTransactionForSync({
              accountId: account.id,
              tx,
              accountHasPendingRows,
              ownAccountIds,
            });

            const incomingStatus = getRawTransactionStatus({ externalData: tx.metadata });

            // A cancellation or rejection is the end of the payment: the row stored
            // while it was still pending has to go, and nothing about the payload may
            // be written back. A row the user made load-bearing is kept instead —
            // losing their splits, tags or transfer is worse than an extra row.
            // A soft-deleted row stays too: hard-deleting it would drop it from reconciliation history.
            if (isRevokedStatus({ status: incomingStatus })) {
              const storedStatus = getRawTransactionStatus({ externalData: existingTx?.externalData });
              if (existingTx && !existingTx.deletedAt && isPreBookingStatus({ status: storedStatus })) {
                if (await this.hasDependentRows({ tx: existingTx })) {
                  revokedKeptCount++;
                  logger.info(
                    `Enable Banking sync: account ${account.id} kept ${incomingStatus} tx ${existingTx.id} – dependent_rows`,
                  );
                } else {
                  const createdIndex = createdTransactionIds.indexOf(existingTx.id);
                  if (createdIndex !== -1) createdTransactionIds.splice(createdIndex, 1);
                  const mergedIndex = mergedPlannedIds.indexOf(existingTx.id);
                  if (mergedIndex !== -1) mergedPlannedIds.splice(mergedIndex, 1);
                  await existingTx.destroy({ force: true });
                  revokedRemovedCount++;
                }
              }
              continue;
            }

            // A removed pending row the bank now books is a real charge: it comes back and is upgraded below.
            if (
              existingTx?.deletedAt &&
              !existingTx.mergedIntoId &&
              incomingStatus === TransactionStatus.BOOK &&
              isPreBookingRow({ tx: existingTx })
            ) {
              await existingTx.restore();
            }

            // Soft-deleted: the user removed it via reconciliation, so the bank copy must not come back.
            // Only a booking is handed to a still-pending merge survivor: any other payload would
            // re-anchor the survivor onto the removed row's identity and break its own matching.
            if (existingTx?.deletedAt) {
              // A survivor can itself be merged away later, so follow the chain to the live row.
              let survivor: Transactions | null = null;
              let nextId = incomingStatus === TransactionStatus.BOOK ? existingTx.mergedIntoId : null;
              while (nextId) {
                survivor = await findOneTransaction({
                  planned: 'exclude',
                  access: 'unscoped-internal',
                  balanceAdjustments: 'include',
                  paranoid: false,
                  where: { id: nextId, accountId: account.id },
                });
                nextId = survivor?.deletedAt ? survivor.mergedIntoId : null;
              }
              if (!survivor || survivor.deletedAt || !isPreBookingRow({ tx: survivor })) {
                softDeletedSkippedCount++;
                continue;
              }
              existingTx = survivor;
            }

            if (existingTx) {
              const existingMeta = existingTx.externalData as typeof tx.metadata;
              const storedStatus = getRawTransactionStatus({ externalData: existingMeta });
              // A stored pre-booking row that already carries an entryReference counts
              // as booked here on purpose: it is frozen against pending re-sends, while
              // tier 1 still matches it and its BOOK copy upgrades it normally.
              const storedIsBooked =
                storedStatus === TransactionStatus.BOOK || getEntryReference({ tx: existingTx }) !== null;

              // Some ASPSPs keep re-sending the pending entry for days after booking.
              // Writing it back would trade booked identity, dates and remittance for
              // stale pending data, so the stored row wins outright.
              if (storedIsBooked && isPreBookingStatus({ status: incomingStatus })) {
                stalePendingIgnoredCount++;
                logger.info(
                  `Enable Banking sync: account ${account.id} ignored stale ${incomingStatus} payload (hash ${tx.externalId}) for booked tx ${existingTx.id}`,
                );
                continue;
              }

              // Re-anchor originalId when matched by a non-hash path so subsequent
              // syncs hit the canonical hash directly and don't pay the fallback cost.
              const updates: Partial<{
                originalId: string;
                time: Date;
                note: string;
                externalReference: string;
                externalData: typeof tx.metadata;
                transactionType: TRANSACTION_TYPES;
              }> = {};
              if (existingTx.originalId !== tx.externalId) {
                updates.originalId = tx.externalId;
              }
              if (!existingTx.externalReference) {
                const referenceNumber = getReferenceNumber({ externalData: tx.metadata });
                if (referenceNumber) updates.externalReference = referenceNumber;
              }
              // Backfill bookingDate / refresh metadata when the bank populates
              // fields after the initial sync.
              const bookingDateAppeared = !existingMeta?.bookingDate && Boolean(tx.metadata?.bookingDate);
              // A stored pre-booking row must leave the pending pool the moment its
              // booked copy arrives, whichever tier matched it. While it still reads
              // PDNG or HOLD, findExistingTransactionForSync can merge an unrelated
              // same-amount purchase into it.
              const pendingBecameBooked =
                incomingStatus === TransactionStatus.BOOK && isPreBookingStatus({ status: storedStatus });
              if (pendingBecameBooked) {
                // Some ASPSPs flag a pending payment with the wrong direction;
                // the booked copy is authoritative.
                const incomingType =
                  tx.metadata?.isExpense === true ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income;
                if (incomingType !== existingTx.transactionType) updates.transactionType = incomingType;
              }
              // Read before the merge below overwrites the stored payload.
              const storedSyncNote = syncGeneratedNote({ tx: existingTx });
              if ((bookingDateAppeared || pendingBecameBooked) && existingTx.time.getTime() !== tx.date.getTime()) {
                updates.time = tx.date;
              }
              if (bookingDateAppeared || updates.originalId || pendingBecameBooked) {
                // Merge, never replace: create-time keys the incoming payload omits
                // (merchantName, which payee extraction reads) must survive.
                const mergedExternalData = {
                  ...existingMeta,
                  ...withoutUndefinedValues({ source: tx.metadata ?? {} }),
                };
                if (pendingBecameBooked) {
                  if (updates.originalId && existingTx.originalId) {
                    // The pending entry often keeps arriving after its booked copy;
                    // tier 2 resolves that stale payload back to this row through here.
                    mergedExternalData.pendingHash = existingTx.originalId;
                  }
                  if (tx.metadata?.balanceAfter === undefined) {
                    // The stored value is the pending-time available balance. Keeping it
                    // would make the Balances hook write it as the booked day's total.
                    delete mergedExternalData.balanceAfter;
                  }
                  const incomingMerchant = cleanMerchantName({ merchantName: tx.merchantName });
                  if (incomingMerchant && !existingMeta?.merchantName) {
                    mergedExternalData.merchantName = incomingMerchant;
                  }
                }
                updates.externalData = mergedExternalData;
              }
              if (pendingBecameBooked && storedSyncNote !== null && existingTx.note === storedSyncNote) {
                // The pending payload's remittance text is a placeholder at many banks.
                // Only refresh it while the note is still exactly what sync wrote.
                const incomingRaw = getRawTransaction({ externalData: tx.metadata });
                const incomingNote = incomingRaw ? deriveNoteFromRaw({ rawTransaction: incomingRaw }) : tx.description;
                if (incomingNote !== storedSyncNote) updates.note = incomingNote;
              }

              if (Object.keys(updates).length > 0) {
                await existingTx.update(updates);
                updatedCount++;
              }
              if (pendingBecameBooked) {
                bookedUpgradedTransactionIds.push(existingTx.id);
              }
              continue;
            }

            // Determine transaction type from metadata
            const isExpense = tx.metadata?.isExpense === true;

            const defaultCategoryId = await getUserDefaultCategory({ id: connection.userId });

            // Forwarded into `externalData.merchantName` for audit and historical
            // Payee-promotion scans, and as `rawMerchantName` for the per-row
            // extraction pipeline.
            const merchantNameClean = cleanMerchantName({ merchantName: tx.merchantName });

            // TODO: consider creating transactions in batch?
            // Create transaction using service (handles all required fields)
            const createResult = await createTransaction({
              originalId: tx.externalId,
              note: tx.description,
              externalReference: getReferenceNumber({ externalData: tx.metadata }),
              amount: Money.fromCents(Math.abs(tx.amount)), // Ensure positive value
              time: tx.date,
              externalData: {
                ...tx.metadata,
                merchantName: merchantNameClean || undefined,
              },
              commissionRate: Money.zero(),
              cashbackAmount: Money.zero(),
              accountId: account.id,
              userId: connection.userId,
              transactionType: isExpense ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
              paymentType: PAYMENT_TYPES.bankTransfer,
              categoryId: defaultCategoryId,
              transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
              accountType: ACCOUNT_TYPES.enableBanking,
              rawMerchantName: merchantNameClean || null,
              matchPlanned,
            });

            const [createdTx] = createResult;

            // A merged row is not a new row: it keeps the user's category and payee, which
            // the post-sync listeners on the emitted ids would overwrite.
            if (createResult.mergedIntoPlanned) {
              mergedPlannedIds.push(createdTx.id);
            } else {
              createdTransactionIds.push(createdTx.id);
            }

            if (isPreBookingStatus({ status: incomingStatus })) {
              accountHasPendingRows = true;
            }
          }

          // Log sync stats
          if (
            createdTransactionIds.length > 0 ||
            updatedCount > 0 ||
            mergedPlannedIds.length > 0 ||
            stalePendingIgnoredCount > 0 ||
            revokedRemovedCount > 0 ||
            revokedKeptCount > 0 ||
            softDeletedSkippedCount > 0
          ) {
            logger.info(
              `Enable Banking sync: ${createdTransactionIds.length} created, ${updatedCount} updated, ${mergedPlannedIds.length} planned confirmed, ${stalePendingIgnoredCount} stale pending ignored, ${revokedRemovedCount} revoked removed, ${revokedKeptCount} revoked kept, ${softDeletedSkippedCount} soft-deleted skipped for account ${account.id}`,
            );
          }

          if (oldestPendingDate !== storedOldestPendingDate) {
            await account.update({ externalData: { ...account.externalData, oldestPendingDate } });
          }

          await notifyPlannedConfirmations({
            userId: connection.userId,
            accountId: account.id,
            mergedCount: mergedPlannedIds.length,
          });

          // Runs before the authoritative write below so today's row ends up
          // holding the bank's own balance rather than a re-derived one.
          await this.reconcileDailyClosingBalances({ account, providerTransactions });

          // Always update account balance from bank when syncing
          // This ensures balance stays accurate even if no new transactions were found
          const balance = await this.fetchBalance(connectionId, apiUid);
          await writeBankBalanceWithHistory({ account, balance: Money.fromCents(balance.amount) });

          return { transactionIds: createdTransactionIds, extraAutoLinkCandidateIds: bookedUpgradedTransactionIds };
        },
      });
    } catch (error) {
      return this.handleProviderError({ error, connectionId });
    }
  }

  /**
   * Re-derives the closing balance of every booking day this batch touched.
   *
   * The per-transaction hook can only see one row, so it leaves each day holding
   * whichever of its rows was written last. Here the whole day is in hand and the
   * row that actually closes it can be identified from the ladder itself. Reads
   * the day back from storage rather than from the batch, so a day split across
   * two syncs is still judged on all of its rows.
   *
   * Days whose ladder does not resolve keep the value already stored.
   */
  private async reconcileDailyClosingBalances({
    account,
    providerTransactions,
  }: {
    account: Accounts;
    providerTransactions: ProviderTransaction[];
  }): Promise<void> {
    const bookingDates = [
      ...new Set(
        providerTransactions
          .map((tx) => getBookingDate({ externalData: tx.metadata }))
          .filter((bookingDate): bookingDate is string => bookingDate !== null),
      ),
    ];
    if (bookingDates.length === 0) return;

    const storedRows = await findTransactions({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      completeness: 'all',
      where: {
        accountId: account.id,
        [Op.and]: [
          Sequelize.where(Sequelize.literal(`"externalData"->>'bookingDate'`), {
            [Op.in]: bookingDates,
          }),
        ],
      },
    });

    const rowsByBookingDate = new Map<string, Transactions[]>();
    for (const row of storedRows) {
      const bookingDate = getBookingDate({ externalData: row.externalData });
      if (!bookingDate) continue;
      const dayRows = rowsByBookingDate.get(bookingDate);
      if (dayRows) dayRows.push(row);
      else rowsByBookingDate.set(bookingDate, [row]);
    }

    let unresolvedDays = 0;
    let ratelessDays = 0;

    // Ascending, so concurrent syncs of one account take the same `Balances` rows
    // in the same order. Map iteration would follow whatever order Postgres
    // returned, and these row locks are held until the sync transaction commits.
    for (const bookingDate of [...rowsByBookingDate.keys()].sort()) {
      const dayRows = rowsByBookingDate.get(bookingDate)!;
      const ladder: ClosingBalanceRow[] = [];
      const rowsById = new Map<string, Transactions>();
      let dayHasUnusableRow = false;

      for (const row of dayRows) {
        // A pre-booking row reports available funds, a ladder of its own, so its
        // absence from this one is not a hole in the day.
        if (isPreBookingStatus({ status: getRawTransactionStatus({ externalData: row.externalData }) })) continue;

        const balanceAfter = (row.externalData as { balanceAfter?: AmountType } | null)?.balanceAfter;
        const balanceDecimal = balanceAfter ? Number.parseFloat(balanceAfter.amount) : Number.NaN;

        // A booked row the ladder cannot use is a missing rung, and a day with a
        // hole in it has no determinable close: the rows either side of the hole
        // no longer rule each other out, so a mid-day row can end up looking like
        // the day's last.
        if (!balanceAfter || balanceAfter.currency !== row.currencyCode || !Number.isFinite(balanceDecimal)) {
          dayHasUnusableRow = true;
          break;
        }

        const signedCents =
          row.transactionType === TRANSACTION_TYPES.income ? row.amount.toCents() : -row.amount.toCents();

        ladder.push({
          id: row.id,
          balanceAfterCents: Math.round(balanceDecimal * 100),
          deltaCents: signedCents,
        });
        rowsById.set(row.id, row);
      }

      const closingRowId = dayHasUnusableRow ? null : findClosingRowId({ rows: ladder });
      if (closingRowId === null) {
        if (ladder.length > 0 || dayHasUnusableRow) unresolvedDays++;
        continue;
      }

      const date = parseBookingDay({ bookingDate });
      if (!date) continue;

      const closingRow = rowsById.get(closingRowId)!;
      const closingBalance = (closingRow.externalData as { balanceAfter?: AmountType } | null)!.balanceAfter!;

      let refBalance: Money;
      try {
        const exchangeRateData = await getExchangeRate({
          userId: closingRow.userId,
          date,
          baseCode: closingRow.currencyCode,
          quoteCode: closingRow.refCurrencyCode,
        });
        refBalance = Money.fromDecimal(
          roundHalfToEven(Number.parseFloat(closingBalance.amount) * exchangeRateData.rate * 100) / 100,
        );
      } catch {
        // A day with no rate on record is one day of chart, and this pass runs
        // late enough that throwing would discard every transaction the sync just
        // stored. Scoped to the lookup on purpose: a failed write must still
        // propagate, or the aborted transaction surfaces later as nonsense.
        ratelessDays++;
        continue;
      }

      await Balances.updateAccountBalance({ accountId: account.id, date, refBalance });
    }

    if (unresolvedDays > 0) {
      logger.info(
        `Enable Banking sync: account ${account.id} left ${unresolvedDays} booking day(s) without a balance; the day's ladder did not resolve to a single closing row`,
      );
    }

    if (ratelessDays > 0) {
      logger.info(
        `Enable Banking sync: account ${account.id} left ${ratelessDays} booking day(s) without a balance; no exchange rate on record for that day`,
      );
    }
  }

  /**
   * Initial-sync: shrink lookback until bank accepts it. Schedule in
   * INITIAL_SYNC_FALLBACK_DAYS. Only date-range rejections retry –
   * auth/network/5xx rethrow immediately. On full exhaustion, log the
   * cascade before rethrowing (caller would otherwise see only the 90d failure).
   */
  private async fetchInitialTransactionsWithShrinkingWindow({
    connectionId,
    apiUid,
    accountExternalId,
    accountId,
    to,
  }: {
    connectionId: string;
    apiUid: string;
    accountExternalId: string;
    accountId: string;
    to: Date;
  }): Promise<ProviderTransaction[]> {
    let lastError: unknown;
    for (const days of INITIAL_SYNC_FALLBACK_DAYS) {
      const from = new Date(to.getTime() - days * MS_PER_DAY);
      try {
        return await this.fetchTransactions(connectionId, apiUid, { from, to }, accountExternalId);
      } catch (error) {
        if (!isAspspDateRangeRejection(error)) {
          logger.info(`Enable Banking initial sync: non-retryable error during ${days}-day window attempt`, {
            connectionId,
            accountId,
          });
          throw error;
        }
        lastError = error;
        logger.info(`Enable Banking initial sync: ASPSP rejected ${days}-day lookback; trying smaller window`, {
          connectionId,
          accountId,
        });
      }
    }
    logger.error(
      {
        message: 'Enable Banking initial sync: every fallback lookback window rejected by ASPSP',
        error: lastError as Error,
      },
      { connectionId, accountId, attempted: [...INITIAL_SYNC_FALLBACK_DAYS] },
    );
    throw lastError;
  }

  // ============================================================================
  // Balance Operations
  // ============================================================================

  async fetchBalance(connectionId: string, accountExternalId: string): Promise<ProviderBalance> {
    const credentials = await this.getValidatedCredentials(connectionId);

    if (!credentials.sessionId) {
      throw new BadRequestError({ message: t({ key: 'bankDataProviders.enableBanking.noActiveSessionGeneric' }) });
    }

    const apiClient = new EnableBankingApiClient(credentials);
    const balances = await apiClient.getAccountBalances(accountExternalId);

    const balance = pickAccountBalance({ balances });

    logger.info('[balance-diag] Enable Banking fetchBalance balances', {
      connectionId,
      selectedType: balance?.balance_type ?? null,
      balances: balancesForLog({ balances }),
    });

    if (!balance) {
      throw new NotFoundError({ message: t({ key: 'bankDataProviders.enableBanking.noBalanceInfo' }) });
    }

    const balanceFloat = parseFloat(balance.balance_amount.amount);
    const balanceSystemAmount = Money.fromDecimal(balanceFloat).toCents();

    return {
      amount: balanceSystemAmount,
      currency: balance.balance_amount.currency,
      asOf: balance.reference_date ? new Date(balance.reference_date) : new Date(),
    };
  }

  async refreshBalance(connectionId: string, systemAccountId: string): Promise<void> {
    const account = await this.getSystemAccount(systemAccountId);

    if (!account.externalId) {
      throw new BadRequestError({ message: t({ key: 'accounts.accountNoExternalId' }) });
    }

    // Get uid from metadata for API calls (session-specific)
    // Fall back to externalId for backward compatibility
    const metadata = account.externalData as Record<string, unknown> | null;
    const apiUid = (metadata?.uid as string) || account.externalId;

    const balance = await this.fetchBalance(connectionId, apiUid);

    await writeBankBalanceWithHistory({ account, balance: Money.fromCents(balance.amount) });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Start OAuth authorization flow
   */
  private async startAuthorizationFlow(
    apiClient: EnableBankingApiClient,
    bankName: string,
    bankCountry: string,
    redirectUrl: string,
    state: string,
    validUntil: Date,
  ): Promise<StartAuthorizationResponse> {
    return await apiClient.startAuthorization({
      access: {
        valid_until: validUntil.toISOString(),
      },
      aspsp: {
        name: bankName,
        country: bankCountry,
      },
      state,
      redirect_url: redirectUrl,
      psu_type: PSUType.Personal,
    });
  }

  /**
   * Generic provider error handler for API calls that use an active session.
   * Handles ForbiddenError (403) by marking the connection as expired so the UI
   * reflects the correct state. Always re-throws the original error so the caller
   * can continue with its own error handling (e.g. setting sync status).
   *
   * Must be called with { transaction: null } awareness: the save bypasses the
   * current CLS transaction intentionally so the update survives a rollback.
   */
  private async handleProviderError({ error, connectionId }: { error: unknown; connectionId: string }): Promise<never> {
    if (error instanceof ForbiddenError) {
      try {
        const connection = await this.getConnection(connectionId);
        const metadata = connection.metadata as unknown as EnableBankingMetadata;

        connection.isActive = false;
        const updatedMetadata: EnableBankingMetadata = {
          ...metadata,
          consentValidUntil: new Date().toISOString(),
          // Marks the deactivation as upstream-driven (vs. user-initiated) so
          // the sync-status endpoint surfaces it in the "needs reauth" list.
          deactivationReason: DEACTIVATION_REASON.AUTH_FAILURE,
        };
        connection.metadata = updatedMetadata as unknown as object;
        // { transaction: null } bypasses the current CLS transaction so this write
        // is committed immediately even if an outer transaction rolls back.
        await connection.save({ transaction: null });

        logger.info(`Connection ${connectionId} marked as expired due to 403 session error`);
      } catch (updateError) {
        logger.error(
          { message: 'Failed to mark connection as expired after 403 error', error: updateError as Error },
          { connectionId },
        );
      }
    }

    throw error;
  }

  /**
   * Type guard for connection parameters
   */
  private isValidConnectionParams(credentials: unknown): credentials is EnableBankingConnectionParams {
    const creds = credentials as EnableBankingConnectionParams;
    return (
      typeof creds === 'object' &&
      creds !== null &&
      typeof creds.appId === 'string' &&
      typeof creds.privateKey === 'string' &&
      typeof creds.bankName === 'string' &&
      typeof creds.bankCountry === 'string'
    );
  }

  /**
   * Type guard for credentials
   */
  private isValidCredentials(credentials: unknown): credentials is EnableBankingCredentials {
    const creds = credentials as EnableBankingCredentials;
    return (
      typeof creds === 'object' &&
      creds !== null &&
      typeof creds.appId === 'string' &&
      typeof creds.privateKey === 'string'
    );
  }

  /**
   * Get and validate credentials
   */
  private async getValidatedCredentials(connectionId: string): Promise<EnableBankingCredentials> {
    const credentials = (await this.getDecryptedCredentials(connectionId)) as unknown as EnableBankingCredentials;

    if (!this.isValidCredentials(credentials)) {
      throw new ValidationError({ message: t({ key: 'bankDataProviders.enableBanking.invalidStoredCredentials' }) });
    }

    return credentials;
  }

  /**
   * Refresh account metadata from Enable Banking API.
   * This is used to update rawAccountData and uid for accounts that were created
   * before these fields were stored, or when the session has been refreshed.
   *
   * @param connectionId - The connection ID
   * @param account - The account to refresh
   * @returns The fresh account data from the API, or null if not found
   */
  private async refreshAccountMetadata({
    connectionId,
    account,
  }: {
    connectionId: string;
    account: Accounts;
  }): Promise<EnableBankingAccount | null> {
    const credentials = await this.getValidatedCredentials(connectionId);

    if (!credentials.sessionId) {
      logger.info(`Cannot refresh account metadata: no active session for connection ${connectionId}`);
      return null;
    }

    const apiClient = new EnableBankingApiClient(credentials);

    // Get the current session to find matching account
    const session = await apiClient.getSession(credentials.sessionId);

    // Get existing metadata for matching
    const existingMetadata = account.externalData as Record<string, unknown> | null;
    const existingIban = existingMetadata?.iban as string | undefined;

    // Fetch details for all accounts in session to find match
    const accountsDetails = await Promise.all(
      session.accounts.map(async (accountUid) => {
        try {
          return await apiClient.getAccountDetails(accountUid);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(`Failed to fetch details for account uid ${accountUid}: ${errorMessage}`);
          return null;
        }
      }),
    );

    // Filter out null results
    const validAccountsDetails = accountsDetails.filter((d): d is EnableBankingAccount => d !== null);

    // Primary: match by identification_hash (externalId now stores this stable ID)
    let matchingAccount = validAccountsDetails.find((details) => details.identification_hash === account.externalId);

    // Fallback: match by IBAN + currency (for legacy accounts where externalId was uid)
    if (!matchingAccount && existingIban) {
      matchingAccount = validAccountsDetails.find(
        (details) => details.account_id?.iban === existingIban && details.currency === account.currencyCode,
      );
    }

    if (!matchingAccount) {
      // No match found - account needs to be re-linked by user
      logger.warn(
        `Could not find matching account in session for account ${account.id} ` +
          `(${account.name}, ${account.currencyCode}). Account needs to be re-linked.`,
      );
      return null;
    }

    // Update account's externalData with fresh metadata
    const updatedMetadata = {
      ...existingMetadata,
      iban: matchingAccount.account_id?.iban,
      product: matchingAccount.product,
      ownerName: matchingAccount.owner_name,
      accountServicer: matchingAccount.account_servicer?.name,
      bic: matchingAccount.account_servicer?.bic_fi,
      uid: matchingAccount.uid, // Session-specific uid for API calls
      rawAccountData: matchingAccount, // Full account data
    };

    await account.update({ externalData: updatedMetadata });

    logger.info(`Refreshed account metadata for account ${account.id} (uid: ${matchingAccount.uid})`);

    return matchingAccount;
  }

  /**
   * Migrate transaction hashes when account externalId changes.
   * This recalculates all transaction originalIds using the new externalId.
   *
   * @param account - The account whose transactions need migration
   * @param newExternalId - The new externalId (identification_hash)
   * @returns Number of transactions migrated
   *
   * @deprecated Temporary migration for legacy accounts (pre-identification_hash).
   * Can be removed once all accounts have been migrated to use identification_hash as externalId.
   */
  private async migrateTransactionHashes({
    account,
    newExternalId,
  }: {
    account: Accounts;
    newExternalId: string;
  }): Promise<number> {
    // Skip if externalId hasn't changed
    if (account.externalId === newExternalId) {
      return 0;
    }

    logger.info(
      `Migrating transaction hashes for account ${account.id} from ${account.externalId} to ${newExternalId}`,
    );

    // Get all transactions for this account
    const transactions = await findTransactions({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      completeness: 'all',
      where: { accountId: account.id },
      paranoid: false,
    });

    let migratedCount = 0;

    for (const tx of transactions) {
      const rawTransaction = getRawTransaction({ externalData: tx.externalData });

      if (!rawTransaction) {
        logger.info(`Transaction ${tx.id} has no rawTransaction in externalData, skipping migration`);
        continue;
      }

      // Calculate new hash using the new externalId (identification_hash)
      const newOriginalId = generateTransactionHash({
        tx: rawTransaction,
        accountExternalId: newExternalId,
      });

      const updates: { originalId?: string; externalData?: Transactions['externalData'] } = {};
      if (tx.originalId !== newOriginalId) {
        updates.originalId = newOriginalId;
      }

      const externalData = tx.externalData as Record<string, unknown> | null;
      if (externalData && externalData.pendingHash !== undefined) {
        // pendingHash was derived from the old account externalId and the pending-era
        // payload is gone, so it can never be recomputed or matched again.
        const withoutPendingHash = { ...externalData };
        delete withoutPendingHash.pendingHash;
        updates.externalData = withoutPendingHash;
      }

      if (Object.keys(updates).length > 0) {
        await tx.update(updates);
        if (updates.originalId) migratedCount++;
      }
    }

    // Update account's externalId to the new value
    await account.update({ externalId: newExternalId });

    logger.info(`Migrated ${migratedCount} transaction hashes for account ${account.id}`);

    return migratedCount;
  }

  /**
   * Tiered match for an incoming provider transaction against existing rows.
   * Order matters – earlier paths are stronger guarantees.
   */
  private async findExistingTransactionForSync({
    accountId,
    tx,
    accountHasPendingRows,
    ownAccountIds,
  }: {
    accountId: string;
    tx: ProviderTransaction;
    accountHasPendingRows: boolean;
    ownAccountIds: string[];
  }): Promise<Transactions | null> {
    const entryReference = tx.metadata?.entryReference as string | undefined;

    // (1) entry_reference: ASPSP promises this is unique + immutable per account.
    // Cheapest, strongest match – short-circuits the rest.
    if (entryReference) {
      const byEntryRef = await findOneTransaction({
        planned: 'exclude',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        where: {
          accountId,
          [Op.and]: [Sequelize.where(Sequelize.literal(`"externalData"->>'entryReference'`), entryReference)],
        },
        paranoid: false,
        order: [['deletedAt', 'ASC NULLS FIRST']],
      });
      if (byEntryRef) return byEntryRef;
    }

    // (2) originalId: the legacy hash. Catches the steady state where the bank
    // consistently returns the same fields (or no entry_reference at all).
    // `pendingHash` is the hash a row carried while it was pending, kept so a
    // pending entry the ASPSP re-sends after booking still lands on the same row.
    // `originalSource.originalId` is the snapshot account-unlink takes before
    // nulling originalId; matching it dedups the unlink → reconnect flow, and the
    // caller's re-anchor restores originalId for future syncs.
    const byOriginalId = await findOneTransaction({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      where: {
        accountId,
        [Op.or]: [
          { originalId: tx.externalId },
          Sequelize.where(Sequelize.literal(`"externalData"->>'pendingHash'`), tx.externalId),
          Sequelize.where(Sequelize.literal(`"externalData"#>>'{originalSource,originalId}'`), tx.externalId),
        ],
      },
      paranoid: false,
      order: [['deletedAt', 'ASC NULLS FIRST']],
    });
    if (byOriginalId) return byOriginalId;

    const isExpense = tx.metadata?.isExpense === true;
    const transactionType = isExpense ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income;
    const counterpartyIban = isExpense
      ? (tx.metadata?.creditorAccount as string | undefined)
      : (tx.metadata?.debtorAccount as string | undefined);
    const fingerprintBase = {
      accountId,
      amount: Math.abs(tx.amount),
      currencyCode: tx.currency,
      transactionType,
    };

    // (3) IBAN fingerprint. Safety net for ASPSPs that never populate
    // entry_reference and shift the date used in the hash between syncs, and for
    // the sync where an entry_reference-less row finally gets one. Requires a
    // matching counterparty IBAN so recurring same-amount payments to different
    // parties don't collapse, and only considers rows with no stored
    // entryReference: a row carrying one is either the same transaction (already
    // returned by tier 1) or a different one. The pending-upgrade exception, where
    // the booked copy arrives under a fresh reference, is tier 4's job.
    if (counterpartyIban) {
      const byFingerprint = await findOneTransaction({
        planned: 'exclude',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
        where: {
          ...fingerprintBase,
          time: {
            [Op.between]: [subDays(tx.date, FINGERPRINT_WINDOW_DAYS), addDays(tx.date, FINGERPRINT_WINDOW_DAYS)],
          },
          [Op.and]: [
            Sequelize.where(
              Sequelize.literal(`"externalData"->>'${isExpense ? 'creditorAccount' : 'debtorAccount'}'`),
              counterpartyIban,
            ),
            whereNoEntryReference(),
          ],
        },
        paranoid: false,
        order: [['deletedAt', 'ASC NULLS FIRST']],
      });
      if (byFingerprint) return byFingerprint;
    }

    // (4) Pending upgrade. A card purchase or transfer first arrives as PDNG or
    // HOLD and is re-issued as BOOK with different remittance text and, on some
    // ASPSPs, a different entry_reference, so no earlier tier sees it. Safety comes
    // from the pre-booking-only candidate pool, exact amount/currency/type equality,
    // the IBAN gate below (a different counterparty IBAN never matches), and the
    // caller flipping the matched row to BOOK.
    // A stored entryReference is only tolerated when the incoming payload carries
    // one too: then tier 1 has already ruled out an equal-reference row, so the
    // mismatch is the fresh-reference re-issue. A reference-less payload never
    // reaches tier 1, so it may only consume reference-less candidates.
    if (!accountHasPendingRows) return null;
    if (getRawTransactionStatus({ externalData: tx.metadata }) !== TransactionStatus.BOOK) return null;

    const pendingPoolWhere = {
      ...fingerprintBase,
      // A row the user made load-bearing must not have its time and identity
      // re-stamped by a heuristic; the booked copy lands as its own row instead.
      transferId: { [Op.is]: null },
      refundLinked: false,
      // A pending copy can trail its booking by a day or two of date drift, never
      // by weeks, so the forward side stays narrow.
      time: {
        [Op.between]: [subDays(tx.date, PENDING_UPGRADE_WINDOW_DAYS), addDays(tx.date, FINGERPRINT_WINDOW_DAYS)],
      },
      [Op.and]: entryReference ? [wherePreBookingStatus()] : [wherePreBookingStatus(), whereNoEntryReference()],
    };
    const pendingCandidates = await findTransactions({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      completeness: 'all',
      where: pendingPoolWhere,
    });

    const ibanCompatible = filterIbanCompatible({
      candidates: pendingCandidates,
      counterpartyIban: counterpartyIban ?? null,
      date: tx.date,
    });
    if (pendingCandidates.length > 0 && ibanCompatible.length === 0) {
      logger.info(
        `Enable Banking pending upgrade: account ${accountId} dropped ${pendingCandidates.length} candidate(s) – iban_mismatch_or_fallback_window`,
      );
    }

    const pendingMatch = pickNearestByDate({ candidates: ibanCompatible, date: tx.date });
    if (pendingMatch) {
      const dayDistance = Math.abs(pendingMatch.time.getTime() - tx.date.getTime()) / MS_PER_DAY;
      logger.info(
        `Enable Banking pending upgrade: account ${accountId} matched tx ${pendingMatch.id} at ${dayDistance.toFixed(1)}d, IBAN gate ${counterpartyIban ? 'enforced' : 'not applicable'}`,
      );
      return pendingMatch;
    }

    // Some ASPSPs flag a pending payment with the opposite direction of its booked
    // copy. Only a pending row naming the same parties on the same sides qualifies.
    const incomingRaw = getRawTransaction({ externalData: tx.metadata });
    if (!incomingRaw) return null;

    const mirroredCandidates = await findTransactions({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      completeness: 'all',
      where: {
        ...pendingPoolWhere,
        transactionType: isExpense ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense,
        // Narrower than the same-direction pool: an opposite payment to the same
        // account within two weeks is plausible, within two days much less so.
        time: {
          [Op.between]: [subDays(tx.date, FINGERPRINT_WINDOW_DAYS), addDays(tx.date, FINGERPRINT_WINDOW_DAYS)],
        },
      },
    });
    const sameParties = mirroredCandidates.filter((candidate) => {
      const storedRaw = getRawTransaction({ externalData: candidate.externalData });
      return storedRaw !== null && haveSameParties({ incoming: incomingRaw, stored: storedRaw, ownAccountIds });
    });

    const mirroredMatch = pickNearestByDate({ candidates: sameParties, date: tx.date });
    if (!mirroredMatch) return null;

    const mirroredDayDistance = Math.abs(mirroredMatch.time.getTime() - tx.date.getTime()) / MS_PER_DAY;
    logger.info(
      `Enable Banking pending upgrade: account ${accountId} matched tx ${mirroredMatch.id} at ${mirroredDayDistance.toFixed(1)}d, mirrored direction, same parties`,
    );
    return mirroredMatch;
  }

  /** Whether tier 4 has anything to look at. Cheap enough to run once per sync. */
  private async accountHasPendingRows({ accountId }: { accountId: string }): Promise<boolean> {
    const count = await countTransactions({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      where: {
        accountId,
        [Op.and]: [wherePreBookingStatus()],
      },
    });
    return count > 0;
  }

  /**
   * One-time reconciliation of duplicate pairs that predate the live-sync
   * matcher. Two passes per (amount, currency, type) bucket:
   *
   *   a) booked row + leftover pre-booking row, booked at or after pending and
   *      within PENDING_UPGRADE_WINDOW_DAYS. When the booked row has a
   *      counterparty IBAN, a pending row carrying the same one wins, an
   *      IBAN-less one within IBAN_LESS_FALLBACK_WINDOW_DAYS is the fallback, and
   *      a different IBAN never pairs; when it has none (card purchases) no IBAN
   *      filtering happens. A pending row with an entryReference only pairs with
   *      a booked row that has one too. User edits on the pending copy move to
   *      the survivor.
   *   b) row with entryReference + row without, within ±2 days and sharing a
   *      counterparty IBAN.
   *
   * Pass (b) is the stricter one: it pairs rows on circumstantial IBAN evidence
   * alone, so any scalar divergence aborts the merge, whereas pass (a) has the
   * explicit pre-booking→BOOK signal and can migrate user edits instead. Pass (b) also
   * compares against canonicals as pass (a) left them, so an edit pass (a) just
   * migrated can block a later strict merge.
   *
   * Both passes refuse to delete an orphan with dependent rows. `mergedCount` and
   * `skippedCount` are the row-level outcomes callers and tests assert on;
   * `consideredPairs` and `unresolvedCount` are diagnostics only, and
   * `unresolvedCount` counts rejected pairs, so one row can add several.
   */
  async reconcileDuplicateTransactionsForAccount({
    accountId,
  }: {
    accountId: string;
  }): Promise<{ mergedCount: number; skippedCount: number; consideredPairs: number; unresolvedCount: number }> {
    const account = await this.getSystemAccount(accountId);
    // A planned row records money that has not moved, so it can never be the duplicate
    // of a bank row — and this pass deletes what it pairs off.
    const allTxs = await findTransactions({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      completeness: 'all',
      where: { accountId: account.id },
      order: [['time', 'ASC']],
    });

    // Bucket by (amount, currency, transactionType) so we only compare candidates
    // that could plausibly be the same logical tx. The date-window + IBAN gate
    // happen inside each bucket.
    const buckets = new Map<string, Transactions[]>();
    for (const tx of allTxs) {
      const key = `${tx.amount.toCents()}|${tx.currencyCode}|${tx.transactionType}`;
      const list = buckets.get(key) ?? [];
      list.push(tx);
      buckets.set(key, list);
    }

    let mergedCount = 0;
    let skippedCount = 0;
    let consideredPairs = 0;
    let unresolvedCount = 0;
    // The account owner's default category. On a shared account another member's
    // default reads as a deliberate category, which only makes the merge more
    // conservative – it never deletes more.
    const defaultCategoryId = await getUserDefaultCategory({ id: account.userId });
    const now = new Date();
    const logSkip = ({ orphanId, reason }: { orphanId: RecordId; reason: ReconcileSkipReason }) => {
      logger.info(`Reconcile: skipping orphan tx ${orphanId} (account ${account.id}) – ${reason}`);
    };
    // The FK's ON DELETE SET NULL would otherwise turn a reconciliation merge into the deleted row into a "remove".
    const repointMergedRows = ({ fromId, toId }: { fromId: RecordId; toId: RecordId }) =>
      updateTransactions({
        values: { mergedIntoId: toId },
        where: { accountId: account.id, mergedIntoId: fromId },
        paranoid: false,
        planned: 'include',
        access: 'unscoped-internal',
        balanceAdjustments: 'include',
      });
    // Each check is seven COUNT queries and the same pending row is offered to every
    // booked row in its bucket; nothing inside this run can change the answer.
    const dependentRowsByTxId = new Map<RecordId, boolean>();
    const hasDependentRowsMemoized = async ({ tx }: { tx: Transactions }): Promise<boolean> => {
      const cached = dependentRowsByTxId.get(tx.id);
      if (cached !== undefined) return cached;
      const result = await this.hasDependentRows({ tx });
      dependentRowsByTxId.set(tx.id, result);
      return result;
    };

    for (const candidates of buckets.values()) {
      if (candidates.length < 2) continue;

      const pendingRows = candidates.filter((c) => isPreBookingRow({ tx: c }));
      const bookedRows = candidates.filter((c) => isBookedCanonical({ tx: c }));

      // Nearest-first over every plausible pair, so the closest booked/pending
      // couple wins regardless of iteration order. Deletes are irreversible, so
      // only pairs whose direction is provably consistent (booked at or after
      // pending) are accepted; that misses the occasional pair whose pending
      // value_date estimate postdated the booking, which is the cheaper mistake.
      const pairs: { booked: Transactions; pending: Transactions; distance: number }[] = [];
      for (const booked of bookedRows) {
        const bookedHasEntryReference = getEntryReference({ tx: booked }) !== null;
        // Window first: the IBAN gate's IBAN-less fallback depends on which
        // candidates are in play, so an out-of-window match must not suppress it.
        const eligible = pendingRows.filter((pending) => {
          const distance = booked.time.getTime() - pending.time.getTime();
          if (distance < 0 || distance > PENDING_UPGRADE_WINDOW_DAYS * MS_PER_DAY) return false;
          // A referenced pending row can only be re-issued under a fresh
          // reference, so a reference-less booked row is not its copy.
          return bookedHasEntryReference || getEntryReference({ tx: pending }) === null;
        });
        const ibanCompatible = filterIbanCompatible({
          candidates: eligible,
          counterpartyIban: getCounterpartyIban({ tx: booked }),
          date: booked.time,
        });
        unresolvedCount += pendingRows.length - ibanCompatible.length;
        for (const pending of ibanCompatible) {
          pairs.push({ booked, pending, distance: booked.time.getTime() - pending.time.getTime() });
        }
      }
      pairs.sort(
        (a, b) =>
          a.distance - b.distance || a.booked.id.localeCompare(b.booked.id) || a.pending.id.localeCompare(b.pending.id),
      );
      consideredPairs += pairs.length;

      const pairedBooked = new Set<RecordId>();
      const mergedPending = new Set<RecordId>();
      // A skipped pair must leave both sides free for other pairs, but pass (b)
      // still has to keep its hands off anything pass (a) looked at and rejected.
      const skipTouchedPending = new Set<RecordId>();

      for (const { booked, pending } of pairs) {
        if (pairedBooked.has(booked.id) || mergedPending.has(pending.id)) {
          unresolvedCount++;
          continue;
        }

        const plan = planEditMerge({
          orphan: toEditMergeSide({ tx: pending }),
          canonical: toEditMergeSide({ tx: booked }),
          orphanSyncNote: syncGeneratedNote({ tx: pending }),
          canonicalSyncNote: syncGeneratedNote({ tx: booked }),
          defaultCategoryId,
          now,
        });
        if (plan.action === 'skip') {
          logSkip({ orphanId: pending.id, reason: plan.reason });
          skipTouchedPending.add(pending.id);
          continue;
        }
        if (await hasDependentRowsMemoized({ tx: pending })) {
          logSkip({ orphanId: pending.id, reason: 'dependent_rows' });
          skipTouchedPending.add(pending.id);
          continue;
        }

        const survivorUpdates: typeof plan.valuesToMove & { externalData?: Transactions['externalData'] } = {
          ...plan.valuesToMove,
        };
        const bookedExternalData = booked.externalData as Record<string, unknown> | null;
        // The pending row's hash is the anchor tier 2 needs when the ASPSP re-sends the
        // PDNG payload; without it that payload recreates the duplicate just merged away.
        if (pending.originalId && bookedExternalData?.pendingHash === undefined) {
          survivorUpdates.externalData = { ...bookedExternalData, pendingHash: pending.originalId };
        }
        if (Object.keys(survivorUpdates).length > 0) {
          await booked.update(survivorUpdates);
        }
        await repointMergedRows({ fromId: pending.id, toId: booked.id });
        await pending.destroy({ force: true });
        pairedBooked.add(booked.id);
        mergedPending.add(pending.id);
        mergedCount++;
      }

      for (const pendingId of skipTouchedPending) {
        if (!mergedPending.has(pendingId)) skippedCount++;
      }

      const canonicalRows = candidates.filter(
        (c) => getEntryReference({ tx: c }) !== null && hasSettledStatus({ tx: c }),
      );
      // Pass (a) survivors stay out of pass (b). The case that motivates it: a booked
      // row with no entryReference of its own re-enters as an orphan, and pass (b)
      // would destroy it together with the edits pass (a) migrated onto it.
      const orphanRows = candidates.filter(
        (c) =>
          !mergedPending.has(c.id) &&
          !skipTouchedPending.has(c.id) &&
          !pairedBooked.has(c.id) &&
          getEntryReference({ tx: c }) === null,
      );

      for (const orphan of orphanRows) {
        // IBAN gate: require both rows to share the same counterparty IBAN.
        // Expenses use creditorAccount (money going out to a creditor), income
        // uses debtorAccount. If the orphan has no IBAN (e.g. a manual entry
        // that happens to share amount/currency/type with a bank row), skip –
        // same rule findExistingTransactionForSync applies for live syncs.
        const orphanIban = getCounterpartyIban({ tx: orphan });
        if (!orphanIban) {
          unresolvedCount++;
          continue;
        }

        const canonical = canonicalRows.find(
          (c) =>
            c.id !== orphan.id &&
            Math.abs(c.time.getTime() - orphan.time.getTime()) <= FINGERPRINT_WINDOW_DAYS * MS_PER_DAY &&
            getCounterpartyIban({ tx: c }) === orphanIban,
        );
        if (!canonical) {
          unresolvedCount++;
          continue;
        }

        const blocker = await this.findOrphanDeletionBlocker({ orphan, canonical });
        if (blocker) {
          logSkip({ orphanId: orphan.id, reason: blocker });
          skippedCount++;
          continue;
        }

        await repointMergedRows({ fromId: orphan.id, toId: canonical.id });
        await orphan.destroy({ force: true });
        mergedCount++;
      }
    }

    logger.info(
      `Reconcile complete for account ${account.id}: merged=${mergedCount} skipped=${skippedCount} consideredPairs=${consideredPairs} unresolved=${unresolvedCount}`,
    );

    return { mergedCount, skippedCount, consideredPairs, unresolvedCount };
  }

  /**
   * Conservative gate for reconcile pass (b). Names what would be silently lost
   * by destroying the orphan – dependent rows (transferId, refundLinked, splits,
   * tags, refunds, budgets, subscriptions, group membership) or a user-mutable
   * scalar that diverges from the canonical. Returns null when the orphan is safe
   * to delete.
   *
   * `planEditMerge` is the lenient sibling used by pass (a); pass (b) is
   * deliberately stricter because its pairing evidence is only circumstantial.
   */
  private async findOrphanDeletionBlocker({
    orphan,
    canonical,
  }: {
    orphan: Transactions;
    canonical: Transactions;
  }): Promise<ReconcileSkipReason | null> {
    const orphanNote = orphan.note ?? '';
    const canonicalNote = canonical.note ?? '';
    if (orphanNote !== canonicalNote && orphanNote !== '') return 'note_conflict';
    if (orphan.categoryId !== canonical.categoryId) return 'category_conflict';
    // Same category, but only the orphan proves a human picked it. Deleting it
    // would put the survivor back in the AI-categorization queue.
    if (
      hasManualStamp({ meta: orphan.categorizationMeta }) &&
      !hasManualStamp({ meta: canonical.categorizationMeta })
    ) {
      return 'categorization_conflict';
    }
    if (orphan.paymentType !== canonical.paymentType) return 'payment_type_conflict';
    // payeeLocked marks a Payee the user assigned or cleared by hand.
    if (orphan.payeeLocked && orphan.payeeId !== canonical.payeeId) return 'payee_conflict';

    return (await this.hasDependentRows({ tx: orphan })) ? 'dependent_rows' : null;
  }

  private async hasDependentRows({ tx }: { tx: Transactions }): Promise<boolean> {
    if (tx.transferId) return true;
    if (tx.refundLinked) return true;

    // Loaded lazily to avoid a circular import wave at module load.
    const TransactionTags = (await import('@models/transaction-tags.model')).default;
    const TransactionSplits = (await import('@models/transaction-splits.model')).default;
    const RefundTransactions = (await import('@models/refund-transactions.model')).default;
    const BudgetTransactions = (await import('@models/budget-transactions.model')).default;
    const SubscriptionTransactions = (await import('@models/subscription-transactions.model')).default;
    const TransactionGroupItems = (await import('@models/transaction-group-items.model')).default;

    const transactionId = tx.id;
    const counts = await Promise.all([
      TransactionTags.count({ where: { transactionId } }),
      TransactionSplits.count({ where: { transactionId } }),
      RefundTransactions.count({ where: { originalTxId: transactionId } }),
      RefundTransactions.count({ where: { refundTxId: transactionId } }),
      BudgetTransactions.count({ where: { transactionId } }),
      SubscriptionTransactions.count({ where: { transactionId } }),
      TransactionGroupItems.count({ where: { transactionId } }),
    ]);

    return counts.some((count) => count > 0);
  }
}

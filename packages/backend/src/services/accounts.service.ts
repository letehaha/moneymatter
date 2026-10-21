import type { RecordId } from '@bt/shared/types';
import {
  ACCOUNT_CATEGORIES,
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  AccountExternalData,
  BANK_PROVIDER_TYPE,
  BUDGET_PLAN_ATTACHABLE_ACCOUNT_CATEGORIES,
  TRANSACTION_TRANSFER_NATURE,
  isDedicatedFlowAccountCategory,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { CustomError, ERROR_CODES, NotFoundError, UnexpectedError, ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import * as Accounts from '@models/accounts.model';
import Balances from '@models/balances.model';
import BankDataProviderConnections from '@models/bank-data-provider-connections.model';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import { countTransactions } from '@models/transactions-query';
import { getBaseCurrency } from '@models/users-currencies.model';
import Users from '@models/users.model';
import { isRevaluedAccount, scheduleBalanceRevalue } from '@services/balances/revalue-balance-history.service';
import { applyManualLogoPatch } from '@services/brand-logos';
import { attachEligibleAccounts } from '@services/budget-plans/auto-attach-account';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { releaseIneligibleGoalShares } from '@services/goals/release-ineligible-goal-shares';
import { ensureUserCurrencyConnected } from '@services/sharing/auth/ensure-currency-connected.service';
import {
  cleanupAccountSharesInTx,
  notifyAccountDeleteRecipients,
  type AccountShareCleanupResult,
} from '@services/sharing/cleanup/cleanup-account-shares.service';
import {
  AccountShareContext,
  buildOwnerShareContext,
  getSharedAccountById,
  getSharedAccountsForUser,
} from '@services/sharing/get-shared-accounts.service';
import { convertCrossUserTransfersForAccountIds } from '@services/sharing/household/convert-cross-user-transfers.service';
import { pauseAutomationsReferencing } from '@services/transaction-automations/references';
import { Op } from 'sequelize';

import { absorbBalanceAdjustment } from './accounts/absorb-balance-adjustment';
import { archiveAccount as performArchiveSideEffects } from './accounts/archive-account';
import { lockAccountRow } from './accounts/lock-account-row';
import { removePortfolioTransfersForAccounts } from './accounts/remove-portfolio-transfers-for-accounts';
import { restampRefInitialBalance } from './accounts/restamp-ref-initial-balance';
import { unlinkSubscriptionsFromAccount } from './accounts/unlink-subscriptions-from-account';
import { unlinkTemplatesFromAccount } from './accounts/unlink-templates-from-account';
import { withTransaction } from './common/with-transaction';

type AccountWithRelinkStatus = Accounts.default & {
  needsRelink?: boolean;
  _shareContext?: AccountShareContext;
  _bankProviderType?: BANK_PROVIDER_TYPE | null;
};

/**
 * Batch-load provider types for accounts that have a `bankDataProviderConnectionId` and
 * stamp `_bankProviderType` on each account in place. Lets the serializer expose the
 * provider type so the frontend can render the bank logo without a per-account
 * connection-details lookup (which is owner-scoped and unreachable for share recipients).
 */
async function attachBankProviderTypes(accounts: AccountWithRelinkStatus[]): Promise<void> {
  const connectionIds = Array.from(
    new Set(accounts.map((a) => a.bankDataProviderConnectionId).filter((id): id is RecordId => typeof id === 'string')),
  );
  if (!connectionIds.length) return;

  const connections = await BankDataProviderConnections.findAll({
    where: { id: { [Op.in]: connectionIds } },
    attributes: ['id', 'providerType'],
  });
  const providerTypeById = new Map(connections.map((c) => [c.id, c.providerType as BANK_PROVIDER_TYPE]));

  for (const account of accounts) {
    if (typeof account.bankDataProviderConnectionId === 'string') {
      account._bankProviderType = providerTypeById.get(account.bankDataProviderConnectionId) ?? null;
    }
  }
}

/**
 * Check if an Enable Banking account needs to be re-linked.
 * This is true when the account has rawAccountData with identification_hash,
 * but the externalId doesn't match (meaning it was created with uid instead).
 */
function checkNeedsRelink(account: Accounts.default): boolean {
  // Only check accounts linked to a bank connection
  if (!account.bankDataProviderConnectionId) return false;

  switch (account.type) {
    case ACCOUNT_TYPES.enableBanking: {
      const externalData = account.externalData as AccountExternalData | null;
      if (!externalData) {
        // No externalData means very old account created before we stored raw data
        return true;
      }

      const rawAccountData = externalData.rawAccountData as { identification_hash?: string } | undefined;
      if (!rawAccountData?.identification_hash) {
        // No identification_hash means that account uses old schema – need to be updated
        return true;
      }

      // Account needs re-link if externalId doesn't match the stable identification_hash
      return account.externalId !== rawAccountData.identification_hash;
    }
    default:
      return false;
  }
}

/**
 * Add needsRelink flag to accounts.
 * Uses Object.assign (not spread) to preserve the Sequelize model prototype and Money getters.
 */
function addNeedsRelinkFlag(accounts: Accounts.default[]): AccountWithRelinkStatus[] {
  return accounts.map((account) =>
    Object.assign(account, {
      needsRelink: checkNeedsRelink(account),
    }),
  );
}

/**
 * User-facing account list. Returns the caller's owned accounts plus any accounts that
 * have been shared with them (accepted shares only). Each item carries a `_shareContext`
 * marker that the serializer turns into the public `share` block.
 *
 * Internal callers that should remain owner-scoped (e.g. balance recalculation) must use
 * the model-level `Accounts.getAccountById` / `Accounts.getAccounts` directly.
 */
export const getAccounts = withTransaction(
  async (payload: Accounts.GetAccountsPayload): Promise<AccountWithRelinkStatus[]> => {
    const ownedRaw = await Accounts.getAccounts(payload);
    const ownedWithRelink = addNeedsRelinkFlag(ownedRaw);

    const ownerUser = ownedWithRelink.length ? await Users.findByPk(payload.userId) : null;
    if (ownedWithRelink.length && !ownerUser) {
      // Authenticated caller owns accounts but has no Users row – should never happen
      // (auth middleware guarantees it). Without it _shareContext can't be stamped and
      // the serializer omits the `share` block the frontend needs to distinguish owner
      // vs recipient UI. Log so it doesn't degrade silently.
      logger.error(
        {
          message: 'Authenticated user not found when building owner share context',
          error: new Error(`Users.findByPk returned null for userId=${payload.userId}`),
        },
        { code: 'ACCOUNTS_OWNER_USER_MISSING', userId: payload.userId },
      );
    }
    const ownerContext = ownerUser ? await buildOwnerShareContext({ ownerUser }) : null;

    const owned = ownedWithRelink.map((account) =>
      ownerContext ? Object.assign(account, { _shareContext: ownerContext }) : account,
    );

    const shared = await getSharedAccountsForUser({ userId: payload.userId, type: payload.type });
    // Shared instances aren't passed through `addNeedsRelinkFlag` because non-owners
    // shouldn't see relink state for someone else's bank-linked account.
    const all = [...owned, ...shared];
    await attachBankProviderTypes(all);
    return all;
  },
);

export const getAccountById = withTransaction(
  async (payload: { id: string; userId: number }): Promise<AccountWithRelinkStatus | null> => {
    const owned = await Accounts.getAccountById({ ...payload });

    if (owned) {
      const enriched = Object.assign(owned, { needsRelink: checkNeedsRelink(owned) }) as AccountWithRelinkStatus;
      const ownerUser = await Users.findByPk(payload.userId);
      if (ownerUser) {
        enriched._shareContext = await buildOwnerShareContext({ ownerUser });
      } else {
        // Same integrity-violation signal as `getAccounts` – caller owns this account
        // but has no Users row. Without _shareContext the owner-vs-recipient serializer
        // branch breaks; log so silent UI degradation is visible.
        logger.error(
          {
            message: 'Authenticated user not found when building owner share context for account by id',
            error: new Error(`Users.findByPk returned null for userId=${payload.userId}`),
          },
          { code: 'ACCOUNTS_OWNER_USER_MISSING', userId: payload.userId, accountId: payload.id },
        );
      }
      await attachBankProviderTypes([enriched]);
      return enriched;
    }

    // Fall through to shared lookup; returns null if the caller has no accepted share.
    const shared = await getSharedAccountById({ userId: payload.userId, id: payload.id });
    if (shared) {
      await attachBankProviderTypes([shared]);
    }
    return shared;
  },
);

export const createAccount = withTransaction(
  async (
    payload: Omit<Accounts.CreateAccountPayload, 'refCreditLimit' | 'refInitialBalance'>,
  ): Promise<Accounts.default | null> => {
    try {
      const { logoDomain, logoInitials, logoColor, logoIcon, ...rest } = payload;
      const { userId, accountCategory, creditLimit, currencyCode, initialBalance } = rest;

      if (accountCategory && isDedicatedFlowAccountCategory(accountCategory)) {
        throw new ValidationError({
          message: t({ key: 'accounts.dedicatedFlowCategoryNotAllowed' }),
        });
      }

      await ensureUserCurrencyConnected({ userId, currencyCode });

      const refCreditLimit = await calculateRefAmount({
        userId: userId,
        amount: creditLimit,
        baseCode: currencyCode,
        date: new Date(),
      });

      // At creation the opening balance exists "as of now", so today's rate is the
      // correct stamp. Once transactions older than the account appear (imports,
      // backdated entries), `restampRefInitialBalance` re-derives this at the
      // ledger-boundary date's rate.
      const refInitialBalance = await calculateRefAmount({
        userId,
        amount: initialBalance,
        baseCode: currencyCode,
        date: new Date(),
      });

      return await Accounts.createAccount({
        ...rest,
        refCreditLimit,
        refInitialBalance,
        ...applyManualLogoPatch({ patch: { logoDomain, logoInitials, logoColor, logoIcon } }),
      });
    } catch (e) {
      // A 4xx is the caller's mistake, not a failure of account creation, so it
      // must not be logged at error severity.
      if (e instanceof CustomError && e.httpCode < ERROR_CODES.UnexpectedError) throw e;

      logger.error(
        { message: 'Failed to create account', error: e as Error },
        { code: 'ACCOUNT_CREATE_FAILED', userId: payload.userId, currencyCode: payload.currencyCode },
      );
      throw e;
    }
  },
);

const updateInitialBalance = withTransaction(
  async ({ userId, accountId, initialBalance }: { userId: number; accountId: string; initialBalance: Money }) => {
    const account = await findOrThrowNotFound({
      query: lockAccountRow({ accountId, userId }),
      message: t({ key: 'accounts.accountNotFound' }),
    });
    // absorbBalanceAdjustment keeps a non-system account's initialBalance and would only move currentBalance.
    if (account.type !== ACCOUNT_TYPES.system) {
      throw new ValidationError({
        message: t({ key: 'accounts.initialBalanceOnlySystem' }),
      });
    }

    const delta = initialBalance.subtract(account.initialBalance);
    if (delta.isZero()) return;

    await absorbBalanceAdjustment({ userId, accountId, amountDelta: delta });
  },
);

export const updateAccount = withTransaction(
  async ({
    id,
    externalId,
    loanBalanceCorrection,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    initialBalance: nextInitialBalance,
    ...payload
  }: Accounts.UpdateAccountByIdPayload &
    (Pick<Accounts.UpdateAccountByIdPayload, 'id'> | Pick<Accounts.UpdateAccountByIdPayload, 'externalId'>) & {
      /**
       * Authorises a loan `currentBalance` write – set only by `updateLoan`.
       * Destructured out so it never reaches `Accounts.updateAccountById`; the
       * controller's field allowlist keeps clients from setting it.
       */
      loanBalanceCorrection?: boolean;
    }) => {
    if (nextInitialBalance !== undefined && payload.currentBalance !== undefined) {
      throw new ValidationError({ message: t({ key: 'accounts.initialAndCurrentBalanceTogether' }) });
    }
    if (nextInitialBalance !== undefined) {
      await updateInitialBalance({ userId: payload.userId, accountId: id, initialBalance: nextInitialBalance });
    }

    const accountData = await findOrThrowNotFound({
      query: Accounts.getAccountById({ id, userId: payload.userId }),
      message: t({ key: 'accounts.accountNotFound' }),
    });

    // loan and vehicle require a sidecar row that only the /loans and /vehicles endpoints create.
    if (
      payload.accountCategory !== undefined &&
      payload.accountCategory !== accountData.accountCategory &&
      isDedicatedFlowAccountCategory(payload.accountCategory)
    ) {
      throw new ValidationError({
        message: t({ key: 'accounts.dedicatedFlowCategoryNotAllowed' }),
      });
    }

    // Vehicle value changes only via balance adjustment, which re-anchors depreciation
    if (accountData.accountCategory === ACCOUNT_CATEGORIES.vehicle && payload.currentBalance !== undefined) {
      throw new ValidationError({
        message: t({ key: 'balanceAdjustment.vehicleUseOverride' }),
      });
    }

    // A loan's balance must go through `updateLoan` (PATCH /loans/:id), which negates
    // to the liability convention, appends the balance_correction event, and
    // re-anchors. Enforced in the service so non-HTTP callers can't bypass it.
    if (accountData.accountCategory === ACCOUNT_CATEGORIES.loan) {
      if (payload.currentBalance !== undefined && !loanBalanceCorrection) {
        throw new ValidationError({
          message: t({ key: 'accounts.loanBalanceUseUpdateLoan' }),
        });
      }
      // Changing the category would orphan the LoanDetails sidecar – loans are
      // created/destroyed only via the /loans endpoints.
      if (payload.accountCategory !== undefined && payload.accountCategory !== ACCOUNT_CATEGORIES.loan) {
        throw new ValidationError({
          message: t({ key: 'accounts.loanCategoryImmutable' }),
        });
      }
    }

    // Handle archive side effects when transitioning to archived status
    const isArchiving =
      payload.status === ACCOUNT_STATUSES.archived && accountData.status !== ACCOUNT_STATUSES.archived;
    if (isArchiving) {
      await performArchiveSideEffects({ account: accountData, userId: accountData.userId });
    }

    const wasAttachable = BUDGET_PLAN_ATTACHABLE_ACCOUNT_CATEGORIES.includes(accountData.accountCategory);
    const isAttachable =
      payload.accountCategory === undefined
        ? wasAttachable
        : BUDGET_PLAN_ATTACHABLE_ACCOUNT_CATEGORIES.includes(payload.accountCategory);
    if (wasAttachable && !isAttachable) {
      await BudgetPlanAccounts.destroy({ where: { accountId: accountData.id } });
    }
    if (payload.accountCategory !== undefined && payload.accountCategory !== accountData.accountCategory) {
      await releaseIneligibleGoalShares({
        accountId: accountData.id,
        userId: accountData.userId,
        accountCategory: payload.accountCategory,
      });
    }

    const currentBalanceIsChanging =
      payload.currentBalance !== undefined && !payload.currentBalance.equals(accountData.currentBalance);
    let initialBalance: Money = accountData.initialBalance;
    let refCurrentBalance: Money = accountData.refCurrentBalance;

    /**
     * If `currentBalance` is changing, it means user want to change current balance
     * but without creating adjustment transaction, so instead we change both `initialBalance`
     * and `currentBalance` on the same diff
     */
    if (currentBalanceIsChanging) {
      const diff = payload.currentBalance!.subtract(accountData.currentBalance);

      // System accounts absorb the diff into the opening balance so
      // `currentBalance = initialBalance + Σ(tx)` keeps holding. Its ref side is
      // restamped below at the boundary-date rate, not delta-shifted.
      if (accountData.type === ACCOUNT_TYPES.system) {
        initialBalance = initialBalance.add(diff);
      }

      // `refCurrentBalance` is a spot measure – the new native balance at the latest
      // rate – not the stored ref plus a delta (that would keep the stored blend of
      // historical rates alive). Cache bypassed so a just-edited rate is observed.
      refCurrentBalance = await calculateRefAmount({
        userId: accountData.userId,
        amount: payload.currentBalance!,
        baseCode: accountData.currencyCode,
        date: new Date(),
        bypassCache: true,
      });
    }

    // Credit limit changes recalculate refCreditLimit. It's separate from balance –
    // it doesn't affect currentBalance/refCurrentBalance; the display layer applies
    // it via `displayBalance = currentBalance - creditLimit`.
    const creditLimitIsChanging =
      payload.creditLimit !== undefined && !payload.creditLimit.equals(accountData.creditLimit);
    let adjustedRefCreditLimit: Money | undefined;

    if (creditLimitIsChanging) {
      adjustedRefCreditLimit = await calculateRefAmount({
        userId: accountData.userId,
        amount: payload.creditLimit!,
        baseCode: accountData.currencyCode,
        date: new Date(),
      });
    }

    const logoPatch = applyManualLogoPatch({
      patch: { logoDomain, logoInitials, logoColor, logoIcon },
      stored: accountData,
    });

    // `refInitialBalance` is intentionally NOT written here: the ref side of the
    // opening balance is owned by `restampRefInitialBalance` (boundary-date rate),
    // which runs below and cascades its diff into the Balances history.
    const result = await Accounts.updateAccountById({
      id,
      externalId,
      ...payload,
      ...logoPatch,
      initialBalance,
      refCurrentBalance,
      ...(adjustedRefCreditLimit !== undefined ? { refCreditLimit: adjustedRefCreditLimit } : {}),
    });

    if (!result) {
      throw new UnexpectedError({ message: t({ key: 'accounts.accountUpdateFailed' }) });
    }

    if (!wasAttachable && isAttachable) {
      await attachEligibleAccounts({ userId: accountData.userId, accountIds: [accountData.id] });
    }

    // A foreign-currency opening balance can't be shifted through history as a flat
    // `refInitialBalance` diff: every day has to be re-valued at its own rate.
    const baseCurrency = await getBaseCurrency({ userId: accountData.userId });
    const revalueOwnsHistory =
      !!baseCurrency && isRevaluedAccount({ account: result, baseCurrencyCode: baseCurrency.currencyCode });

    if (!revalueOwnsHistory) {
      await Balances.handleAccountChange({
        account: result,
        prevAccount: accountData,
      });
    }

    let finalAccount = result;
    // The opening balance changed → its base-currency stamp must be re-derived at
    // the ledger-boundary rate (and cascaded into Balances history by the restamp).
    if (currentBalanceIsChanging && accountData.type === ACCOUNT_TYPES.system) {
      await restampRefInitialBalance({ accountId: accountData.id });
      const refetched = await Accounts.getAccountById({ id: accountData.id, userId: accountData.userId });
      if (!refetched) {
        // The account was updated moments ago in this same request, so a miss is an
        // impossible-state (concurrent delete / id drift). Fall back to the pre-restamp
        // `result` row; its `refInitialBalance` may be stale.
        logger.error(
          {
            message:
              'updateAccount: re-fetch after restampRefInitialBalance missed; returning pre-restamp account row, refInitialBalance may be stale',
          },
          { code: 'ACCOUNT_REFETCH_AFTER_RESTAMP_MISSED', accountId: accountData.id, userId: accountData.userId },
        );
      }
      finalAccount = refetched ?? result;
    }

    // Today's net-worth row is a stock equal to the spot `refCurrentBalance`. Pin it
    // last, after the restamp's history cascade, so the spot value wins.
    if (currentBalanceIsChanging && !revalueOwnsHistory) {
      await Balances.setTodayRowToSpot({ account: finalAccount });
    }

    if (revalueOwnsHistory) {
      await scheduleBalanceRevalue({ accountId: finalAccount.id });
    }

    return finalAccount;
  },
);

interface DeleteAccountByIdInTxResult {
  affectedRows: number;
  cleanup: AccountShareCleanupResult;
  /** Snapshotted before destroy so the post-commit notification copy can still reference
   *  the account name after the row is gone. */
  accountSnapshot: { id: string; name: string };
}

const deleteAccountByIdInTx = withTransaction(
  async ({
    id,
    userId,
    removePortfolioTransfers = false,
  }: {
    id: string;
    userId: number;
    removePortfolioTransfers?: boolean;
  }): Promise<DeleteAccountByIdInTxResult> => {
    const account = await Accounts.default.findOne({ where: { id, userId } });
    if (!account) {
      throw new NotFoundError({ message: t({ key: 'accounts.accountNotFound' }) });
    }

    // Cascade-deleting would wipe the source legs of loan payments made from this
    // account; the model hooks would treat that as reversals and silently restore
    // the loan's owed balance. Block until those payments are cleared.
    const loanPaymentCount = await countTransactions({
      planned: 'exclude',
      access: { creator: userId },
      transfers: { natures: [TRANSACTION_TRANSFER_NATURE.transfer_to_loan] },
      balanceAdjustments: 'include',
      where: { accountId: id },
    });
    if (loanPaymentCount > 0) {
      throw new ValidationError({
        message: t({ key: 'accounts.deleteBlockedByLoanPayments' }),
      });
    }

    // Sharing cleanup runs in the same transaction so a destroy failure rolls back the
    // share row deletes and invitation revocations atomically.
    const cleanup = await cleanupAccountSharesInTx({ accountId: id, ownerUserId: userId });

    // Convert cross-user transfer pairs BEFORE the destroy so the partner leg (on the
    // OTHER user's account) isn't left orphaned with a `transferId` pointing at the
    // about-to-be-cascaded leg on this account. Same transaction as the destroy, so a
    // failure rolls everything back together.
    await convertCrossUserTransfersForAccountIds({ accountIds: [id], ownerUserId: userId });

    // The destroy cascades `Subscriptions.accountId` to NULL at the DB level, which trips
    // the auto-record check constraint on any subscription still booking into this account.
    // Clearing both columns first is the only way to satisfy it — the cascade can't.
    await unlinkSubscriptionsFromAccount({ accountId: id });
    await unlinkTemplatesFromAccount({ accountId: id });

    await pauseAutomationsReferencing({ userId, refType: 'account', refId: account.id, label: account.name });

    // Without this opt-in the transfers survive as orphaned contributions and double-count
    // if the user re-creates the account and re-links the same transfers.
    if (removePortfolioTransfers) {
      await removePortfolioTransfersForAccounts({ userId, accountIds: [id] });
    }

    const affectedRows = await Accounts.deleteAccountById({ id, userId });
    if (affectedRows === 0) {
      // Defensive: the findOne above succeeded, so a 0-affectedRows here is a concurrency
      // anomaly (someone else deleted the row between the two queries). Treat it as a 404
      // for the caller so the response stays consistent.
      throw new NotFoundError({ message: t({ key: 'accounts.accountNotFound' }) });
    }

    return {
      affectedRows,
      cleanup,
      accountSnapshot: { id: account.id, name: account.name },
    };
  },
);

export const deleteAccountById = async ({
  id,
  userId,
  removePortfolioTransfers,
}: {
  id: string;
  userId: number;
  removePortfolioTransfers?: boolean;
}) => {
  const result = await deleteAccountByIdInTx({ id, userId, removePortfolioTransfers });

  // Post-commit fan-out: the durable changes (share rows deleted, invitations revoked,
  // account row destroyed) committed in the transaction above. Notifications are
  // best-effort – a transient notify failure must not re-open the deleted account.
  if (result.cleanup.recipients.length > 0 || result.cleanup.householdRecipients.length > 0) {
    const owner = await Users.findByPk(userId);
    await notifyAccountDeleteRecipients({
      recipients: result.cleanup.recipients,
      householdRecipients: result.cleanup.householdRecipients,
      owner,
      account: result.accountSnapshot,
    });
  }

  return result.affectedRows;
};

export { unlinkAccountFromBankConnection } from './accounts/unlink-from-bank-connection';
export { linkAccountToBankConnection } from './accounts/link-to-bank-connection';

import type { AccountBalanceChange, ImportError, RecordId } from '@bt/shared/types';
import { isDedicatedFlowAccountCategory } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils/logger';
import * as Accounts from '@models/accounts.model';
import ImportBatchAccountEffects from '@models/import-batch-account-effects.model';
import { findOneTransaction } from '@models/transactions-query';
import { updateAccount } from '@services/accounts.service';
import { absorbBalanceAdjustment } from '@services/accounts/absorb-balance-adjustment';
import { lockAccountRow } from '@services/accounts/lock-account-row';
import { withTransaction } from '@services/common/with-transaction';
import { importDayKey } from '@services/import-export/core/duplicates/import-day-key';

/**
 * Pre-import snapshot of one linked/existing account, taken BEFORE any imported
 * rows are written. `finalize` computes its back-adjustment from the row tally
 * alone; the snapshot supplies the boundary for classifying rows and the
 * display-only balance used when no adjustment write is needed.
 */
interface AccountBalanceCapture {
  accountId: string;
  /** Account name shown in the done-step summary and desync errors. */
  accountName: string;
  /**
   * `Accounts.currentBalance` as it stood before the import wrote any rows.
   * Display-only: adjustments are computed from the row tally, never from this
   * snapshot, so a concurrent writer's contribution is never clobbered.
   */
  balanceBefore: Money;
  /**
   * Day key (YYYY-MM-DD) of the account's latest existing transaction, or
   * undefined when the account had no transactions. Imported rows dated on/after
   * this day classify as `new`; older rows classify as `historical` (backfill).
   */
  boundaryDayKey: string | undefined;
}

/** Per-account accumulator over successfully written imported rows. */
interface ImportRowTally {
  /** Σ signed(amount) of rows classified `new` (income +, expense −). */
  deltaNew: Money;
  /** Σ signed(amount) of rows classified `historical` (backfill). */
  deltaHistorical: Money;
  movedCount: number;
  historicalCount: number;
}

// Insert the effects row AFTER the absorb. Inserting first takes KEY SHARE on the
// account through the FK, and upgrading that to the absorb's FOR UPDATE deadlocks
// two finalizes on one account.
const absorbAndRecordEffect = withTransaction(
  async ({
    userId,
    importBatchId,
    accountId,
    amountDelta,
  }: {
    userId: number;
    importBatchId: RecordId;
    accountId: string;
    amountDelta: Money;
  }) => {
    const updated = await absorbBalanceAdjustment({ userId, accountId, amountDelta });
    await ImportBatchAccountEffects.create({ importBatchId, accountId, absorbedAmount: amountDelta });
    return updated;
  },
);

const forceTargetAndRecordEffect = withTransaction(
  async ({
    userId,
    importBatchId,
    accountId,
    targetCurrentBalance,
  }: {
    userId: number;
    importBatchId: RecordId;
    accountId: string;
    targetCurrentBalance: Money;
  }) => {
    const account = await lockAccountRow({ accountId, userId });
    if (!account) throw new ValidationError({ message: `Account with ID ${accountId} not found` });
    await updateAccount({ id: accountId, userId, currentBalance: targetCurrentBalance });
    await ImportBatchAccountEffects.update(
      { absorbedAmount: targetCurrentBalance.subtract(account.currentBalance) },
      { where: { importBatchId, accountId } },
    );
  },
);

function emptyTally(): ImportRowTally {
  return {
    deltaNew: Money.zero(),
    deltaHistorical: Money.zero(),
    movedCount: 0,
    historicalCount: 0,
  };
}

/**
 * Account created by the import itself. Created accounts have no pre-import
 * history to protect, so they are never captured or reconciled — `finalize`
 * only (optionally) forces the user-entered balance target and emits their
 * summary entry from a fresh read-back.
 */
export interface CreatedAccountInput {
  accountId: string;
  /** Source account name, used in logs when the account cannot be read back. */
  accountName: string;
  /**
   * User-entered final balance for the account (Wallet's "current balance"
   * field). When set, it is forced via `updateAccount` before the summary
   * read-back — `updateAccount` absorbs the difference into `initialBalance`
   * without spawning an adjustment transaction. Absent means the balance stays
   * at whatever the imported rows produced.
   */
  targetCurrentBalance?: Money;
}

/**
 * Account-level failure shaped to slot directly into both import summaries'
 * error arrays: the rows are committed but the account's balance is not what
 * the user asked for, so the UI must surface it as a destructive warning.
 */
type BalanceReconcileError = Extract<ImportError, { code: 'account-balance-desync' }>;

/**
 * One import run's balance-reconciliation lifecycle. Usage contract:
 *
 * 1. `startBalanceReconciliation` — after account-id resolution but strictly
 *    BEFORE the row-writing loop (once rows land, the balance hook has already
 *    moved `currentBalance` and MAX(time) may include imported rows).
 * 2. `recordRow` — IMMEDIATELY after each row's `createTransaction` commits,
 *    before any post-commit step that can throw. Failed rows roll back their
 *    own transaction and never move the balance, so they must not be recorded.
 * 3. `finalize` — once, after the row loop, to back-adjust every account and
 *    build the done-step summary entries.
 */
interface BalanceReconciliationSession {
  /**
   * Fold one successfully written row into the per-account tally, classifying
   * it against that account's pre-import boundary. Day-granular (same key as
   * duplicate detection): rows on the boundary day count as `new` — date-only
   * rows anchor to midnight, so an instant compare would misclassify genuine
   * same-day activity as backfill. Accounts without a capture (created by the
   * import, or an account with no transactions) have no boundary, so every
   * row is `new`. Synchronous and in-memory.
   */
  recordRow(params: {
    accountId: string;
    /** Row instant (ISO 8601) used for the boundary classification. */
    rowIso: string;
    /** Income positive, expense negative, in the account's own currency. */
    signedAmount: Money;
  }): void;

  /**
   * Back-adjust each account's balance and build the summary. Must run AFTER
   * all rows are written: the balance hook has moved `currentBalance` /
   * `refCurrentBalance` by Σ(all rows), and `finalize` removes the part that
   * must not stay applied, absorbing it into the opening balance
   * (`absorbBalanceAdjustment`, no adjustment transaction).
   *
   * Captured (linked) accounts get a signed adjustment:
   *   recalculateBalance ON  → −Σhistorical (backfill absorbed, new rows stay)
   *   recalculateBalance OFF → −Σall       (pre-import balance preserved)
   * The adjustment is relative to whatever the balance is at write time — never
   * an absolute target from the pre-import snapshot — so two imports finalizing
   * into the same account compose instead of the last writer erasing the other.
   * A zero adjustment skips the write entirely.
   *
   * Created accounts: a `targetCurrentBalance` (when present) is forced first,
   * then the account is read back for its `isNewAccount` summary entry. A
   * failed read-back only costs that entry (warn + skip).
   *
   * Any failed balance write — linked adjustment or created-account target — is
   * reported as an `account-balance-desync` error (the rows are already
   * committed, so the user must see and fix the balance manually) instead of
   * failing the import; processing continues with the remaining accounts. A
   * linked account whose write failed gets no `AccountBalanceChange` entry; a
   * created account still gets one with its actual (read-back) balance.
   */
  finalize(params: {
    /** `ImportBatches.id` of this run; every opening-balance shift is recorded against it for undo. */
    importBatchId: RecordId;
    recalculateBalance: boolean;
    createdAccounts?: CreatedAccountInput[];
    /** Importer name prefixed to log lines (e.g. "CSV import"). */
    logLabel: string;
  }): Promise<{ accountBalanceChanges: AccountBalanceChange[]; errors: BalanceReconcileError[] }>;
}

class BalanceReconciliationSessionImpl implements BalanceReconciliationSession {
  private readonly tallyByAccountId = new Map<string, ImportRowTally>();

  private readonly userId: number;
  private readonly captures: Map<string, AccountBalanceCapture>;

  constructor({ userId, captures }: { userId: number; captures: Map<string, AccountBalanceCapture> }) {
    this.userId = userId;
    this.captures = captures;
  }

  recordRow({ accountId, rowIso, signedAmount }: { accountId: string; rowIso: string; signedAmount: Money }): void {
    const boundaryDayKey = this.captures.get(accountId)?.boundaryDayKey;
    // YYYY-MM-DD keys compare correctly as strings; no boundary means `new`.
    const classification =
      boundaryDayKey !== undefined && importDayKey({ iso: rowIso }) < boundaryDayKey ? 'historical' : 'new';

    const tally = this.tallyByAccountId.get(accountId) ?? emptyTally();
    if (classification === 'new') {
      tally.deltaNew = tally.deltaNew.add(signedAmount);
      tally.movedCount += 1;
    } else {
      tally.deltaHistorical = tally.deltaHistorical.add(signedAmount);
      tally.historicalCount += 1;
    }
    this.tallyByAccountId.set(accountId, tally);
  }

  async finalize({
    importBatchId,
    recalculateBalance,
    createdAccounts = [],
    logLabel,
  }: {
    importBatchId: RecordId;
    recalculateBalance: boolean;
    createdAccounts?: CreatedAccountInput[];
    logLabel: string;
  }): Promise<{ accountBalanceChanges: AccountBalanceChange[]; errors: BalanceReconcileError[] }> {
    const accountBalanceChanges: AccountBalanceChange[] = [];
    const errors: BalanceReconcileError[] = [];

    // Order is load-bearing: force created-account targets first (so the
    // read-back reports the final value), then back-adjust captured accounts,
    // then read created accounts back for their summary entries. All three share
    // the `errors` / `accountBalanceChanges` accumulators.
    await this.#forceCreatedAccountTargets({ importBatchId, createdAccounts, logLabel, errors });
    await this.#reconcileCapturedAccounts({
      importBatchId,
      recalculateBalance,
      logLabel,
      accountBalanceChanges,
      errors,
    });
    await this.#buildCreatedAccountSummaries({ createdAccounts, logLabel, accountBalanceChanges });

    return { accountBalanceChanges, errors };
  }

  /**
   * Created accounts with a user-entered balance target: force it before the
   * read-back in `#buildCreatedAccountSummaries` so the summary entry reports the
   * final value.
   */
  async #forceCreatedAccountTargets({
    importBatchId,
    createdAccounts,
    logLabel,
    errors,
  }: {
    importBatchId: RecordId;
    createdAccounts: CreatedAccountInput[];
    logLabel: string;
    errors: BalanceReconcileError[];
  }): Promise<void> {
    for (const created of createdAccounts) {
      if (created.targetCurrentBalance === undefined) continue;
      try {
        await forceTargetAndRecordEffect({
          userId: this.userId,
          importBatchId,
          accountId: created.accountId,
          targetCurrentBalance: created.targetCurrentBalance,
        });
      } catch (err) {
        logger.error({
          message: `[${logLabel}] Failed to set entered balance for created account "${created.accountName}" — balance may be incorrect`,
          error: err as Error,
        });
        errors.push({
          rowIndex: null,
          code: 'account-balance-desync',
          error: `${created.accountName}: entered balance could not be applied after import; this account balance may be incorrect`,
        });
      }
    }
  }

  /**
   * Captured (linked) accounts: remove this import's own unwanted contribution
   * as a signed adjustment. Sorted so two finalizes touching the same accounts
   * acquire their row locks in the same order (no deadlock).
   */
  async #reconcileCapturedAccounts({
    importBatchId,
    recalculateBalance,
    logLabel,
    accountBalanceChanges,
    errors,
  }: {
    importBatchId: RecordId;
    recalculateBalance: boolean;
    logLabel: string;
    accountBalanceChanges: AccountBalanceChange[];
    errors: BalanceReconcileError[];
  }): Promise<void> {
    const sortedCaptures = Array.from(this.captures.values()).toSorted((a, b) =>
      a.accountId.localeCompare(b.accountId),
    );
    for (const capture of sortedCaptures) {
      const tally = this.tallyByAccountId.get(capture.accountId) ?? emptyTally();
      const amountDelta = recalculateBalance
        ? tally.deltaHistorical.negate()
        : tally.deltaHistorical.add(tally.deltaNew).negate();
      // What the user sees as this import's effect on the balance: rows kept
      // applied. Backfill (and, with the flag OFF, everything) nets to zero.
      const semanticDelta = recalculateBalance ? tally.deltaNew : Money.zero();

      let balanceAfter: Money;
      if (amountDelta.isZero()) {
        // Nothing to remove — the balance hook already left the account at its
        // target, and ref balances derive from the native balance, so a zero native
        // delta leaves nothing to fix. Skipping the write also skips a row lock.
        balanceAfter = capture.balanceBefore.add(semanticDelta);
      } else {
        try {
          const updated = await absorbAndRecordEffect({
            userId: this.userId,
            importBatchId,
            accountId: capture.accountId,
            amountDelta,
          });
          balanceAfter = updated.currentBalance;
        } catch (err) {
          logger.error({
            message: `[${logLabel}] Failed to set post-import balance for linked account "${capture.accountName}" — balance may be incorrect`,
            error: err as Error,
          });
          errors.push({
            rowIndex: null,
            code: 'account-balance-desync',
            error: `${capture.accountName}: balance could not be updated after import; this account balance may be incorrect`,
          });
          continue;
        }
      }

      accountBalanceChanges.push({
        accountId: capture.accountId,
        accountName: capture.accountName,
        // Derived from the post-write balance so the entry stays internally
        // consistent (before + delta = after) even if a concurrent writer moved
        // the account between capture and finalize.
        balanceBefore: balanceAfter.subtract(semanticDelta).toNumber(),
        balanceAfter: balanceAfter.toNumber(),
        delta: semanticDelta.toNumber(),
        movedCount: tally.movedCount,
        historicalCount: tally.historicalCount,
        isNewAccount: false,
      });
    }
  }

  /**
   * Created accounts need no back-adjustment (the balance hook built their
   * balance from the initial balance directly) — only a summary entry read back
   * after the optional target write in `#forceCreatedAccountTargets`.
   */
  async #buildCreatedAccountSummaries({
    createdAccounts,
    logLabel,
    accountBalanceChanges,
  }: {
    createdAccounts: CreatedAccountInput[];
    logLabel: string;
    accountBalanceChanges: AccountBalanceChange[];
  }): Promise<void> {
    for (const created of createdAccounts) {
      let account: Awaited<ReturnType<typeof Accounts.getAccountById>>;
      try {
        account = await Accounts.getAccountById({ userId: this.userId, id: created.accountId });
      } catch (err) {
        // Everything is committed by now — a transient read failure here must
        // only cost this summary entry, never fail the whole import (a bare
        // failure would invite a re-import that duplicates every row).
        logger.warn(
          `[${logLabel}] Created account "${created.accountName}" (${created.accountId}) could not be read back — its balance summary entry is omitted: ${(err as Error).message}`,
        );
        continue;
      }
      if (!account) {
        // The account existed moments ago (created by this import); a missing
        // read-back only costs its summary row, so log it instead of failing.
        logger.warn(
          `[${logLabel}] Created account "${created.accountName}" (${created.accountId}) could not be read back — its balance summary entry is omitted`,
        );
        continue;
      }

      const tally = this.tallyByAccountId.get(created.accountId) ?? emptyTally();
      accountBalanceChanges.push({
        accountId: created.accountId,
        accountName: account.name,
        balanceAfter: account.currentBalance.toNumber(),
        movedCount: tally.movedCount,
        historicalCount: tally.historicalCount,
        isNewAccount: true,
      });
    }
  }
}

/**
 * Open a balance-reconciliation session for one import run: snapshot each
 * pre-existing account the rows will land on (current balance plus the boundary
 * day of its latest transaction, both scoped to the user). Must run after
 * account-id resolution but strictly BEFORE the row-writing loop.
 *
 * `accountIds` is the linked/pre-existing set only — accounts created by the
 * import are passed to `finalize` instead (they have no history to protect, so
 * the recalculate flag does not apply to them).
 *
 * Vehicle and loan accounts are excluded from import balance management (their
 * balance is derived by dedicated flows, and balance writes are rejected for
 * them), so they are omitted with a warning log — no capture, no reconcile, no
 * summary entry.
 */
export async function startBalanceReconciliation({
  userId,
  accountIds,
}: {
  userId: number;
  accountIds: string[];
}): Promise<BalanceReconciliationSession> {
  const captures = new Map<string, AccountBalanceCapture>();

  for (const accountId of new Set(accountIds)) {
    const account = await Accounts.getAccountById({ userId, id: accountId });
    if (!account) {
      throw new ValidationError({ message: `Account with ID ${accountId} not found` });
    }
    if (isDedicatedFlowAccountCategory(account.accountCategory)) {
      // Unreachable through the importers — `assertNotDerivedBalanceAccount`
      // rejects vehicle/loan targets before execution. A caller that skips that
      // guard would otherwise lose this account's capture silently and
      // permanently shift its balance when `finalize` runs without it.
      logger.warn(
        `[import balance capture] Skipping dedicated-flow account "${account.name}" (${accountId}) — its balance is not import-managed`,
      );
      continue;
    }

    // A future-dated planned row would push this boundary forward and make every imported
    // row count as historical, folding the whole import into the opening balance.
    // Adjustment rows are ledger rows like any other, so they can be the boundary.
    const latestTx = await findOneTransaction({
      planned: 'exclude',
      access: { creator: userId },
      balanceAdjustments: 'include',
      where: { accountId },
      attributes: ['time'],
      order: [['time', 'DESC']],
    });

    captures.set(accountId, {
      accountId,
      accountName: account.name,
      balanceBefore: account.currentBalance,
      boundaryDayKey: latestTx ? importDayKey({ iso: latestTx.time.toISOString() }) : undefined,
    });
  }

  return new BalanceReconciliationSessionImpl({ userId, captures });
}

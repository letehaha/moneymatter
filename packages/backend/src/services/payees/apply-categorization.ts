import { CATEGORIZATION_MODE, CATEGORIZATION_SOURCE } from '@bt/shared/types';
import Payees from '@models/payees.model';
import { updateTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';

import { withTransaction } from '../common/with-transaction';

interface ApplyPayeeCategorizationParams {
  /**
   * Owner of the account the row lives on. Used to scope the Payee lookup
   * (Payees are account-owner-scoped on shared accounts). Decoupled from
   * the row's `userId` (creator) so this helper works for cross-creator
   * cases — e.g. the post-sync note fuzzy backfill running under the
   * account owner against a row authored by a shared-account recipient.
   */
  accountOwnerUserId: number;
  transactionId: string;
  payeeId: string;
}

/**
 * Apply a Payee's default category onto a transaction, gated by the Payee's
 * `categorizationMode`. Shared by the inline sync-time path (immediately
 * after the row is inserted with a resolved `payeeId`) and the post-sync
 * note fuzzy backfill (after a fuzzy `note`-based link). Keeping the rule
 * here is what guarantees a row linked via either path stamps
 * `categorizationMeta` consistently — the note backfill used to link
 * without stamping, letting the AI listener re-categorize an
 * `enforce`-mode Payee.
 *
 * The "overridable" gate looks at the currently-committed `categorizationMeta`
 * (re-fetched, since subscription matching may have run in between): only
 * `ai` and `null` get overridden. Higher-precedence sources
 * (`manual`, `userRule`, `subscriptionRule`, and an existing `payeeRule`) are
 * left alone.
 *
 * Returns the updated transaction, the unchanged latest row when nothing
 * applied, or `null` if the row was deleted concurrently.
 *
 * Auth note: the caller is expected to have already authorized the write
 * against this transaction (via account ownership or write-share). This
 * helper does NOT re-authorize — fetching by `id` only, not `(id, userId)`,
 * lets it operate on rows authored by other users on the owner's account.
 */
export const applyPayeeCategorization = withTransaction(
  async ({
    accountOwnerUserId,
    transactionId,
    payeeId,
  }: ApplyPayeeCategorizationParams): Promise<Transactions | null> => {
    const latest = await Transactions.findByPk(transactionId);
    if (!latest) return null;

    const meta = latest.categorizationMeta ?? null;
    const overridable = !meta || meta.source === CATEGORIZATION_SOURCE.ai;
    if (!overridable) return latest;

    const payee = await Payees.findOne({
      where: { id: payeeId, userId: accountOwnerUserId },
      attributes: ['id', 'defaultCategoryId', 'categorizationMode'],
    });
    if (!payee?.defaultCategoryId || payee.categorizationMode === CATEGORIZATION_MODE.off) {
      return latest;
    }

    // `enforce` stamps meta so the AI categorization listener's "meta IS NULL"
    // filter skips the row. `hint` leaves meta null so AI may still override
    // based on the description — right for catch-all merchants (Amazon,
    // Walmart) where the default is a fallback but per-tx context matters.
    const enforceMeta = payee.categorizationMode === CATEGORIZATION_MODE.enforce;
    await updateTransactions({
      values: {
        categoryId: payee.defaultCategoryId,
        categorizationMeta: enforceMeta
          ? {
              source: CATEGORIZATION_SOURCE.payeeRule,
              payeeId: payee.id,
              categorizedAt: new Date().toISOString(),
            }
          : null,
      },
      // The caller picked this exact row and authorized it, so the boundary adds no scope
      // of its own and no row class is filtered out from under it.
      planned: 'include',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      where: { id: transactionId },
    });
    const updated = await Transactions.findByPk(transactionId);
    return updated ?? latest;
  },
);

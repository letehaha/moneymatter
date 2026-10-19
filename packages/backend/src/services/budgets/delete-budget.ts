import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import { logger } from '@js/utils/logger';
import BudgetTransactions from '@models/budget-transactions.model';
import Budgets from '@models/budget.model';
import Users from '@models/users.model';
import { withTransaction } from '@services/common/with-transaction';
import { deleteLogoImage } from '@services/logo-images/logo-images.service';
import {
  BudgetShareCleanupResult,
  cleanupBudgetSharesInTx,
  notifyBudgetDeleteRecipients,
} from '@services/sharing/cleanup/cleanup-budget-shares.service';

interface DeleteBudgetPayload {
  id: string;
  userId: number;
}

interface DeleteBudgetInTxResult {
  success: true;
  /** Captured for the post-commit notification fan-out. `null` when the budget didn't exist
   *  (idempotent delete) or the caller wasn't the owner. */
  postCommit: {
    cleanup: BudgetShareCleanupResult;
    budget: { id: string; name: string };
    ownerUserId: number;
  } | null;
}

export const deleteBudget = async ({ id, userId }: DeleteBudgetPayload) => {
  const result = await deleteBudgetInTx({ id, userId });

  // Post-commit fan-out: notify each recipient that the budget they had access to is
  // gone. Failures don't roll back the delete — the in-app notification is best-effort,
  // matching the account-delete cleanup pattern. Wrap so a transient Users lookup or
  // notify failure doesn't reject the entire delete (the row + shares are already gone).
  if (result.postCommit) {
    try {
      const owner = await Users.findByPk(result.postCommit.ownerUserId);
      await notifyBudgetDeleteRecipients({
        recipients: result.postCommit.cleanup.recipients,
        owner,
        budget: result.postCommit.budget,
      });
    } catch (error) {
      logger.error(
        { message: '[deleteBudget] Post-commit recipient notification failed', error: error as Error },
        {
          code: 'BUDGET_DELETE_POST_COMMIT_NOTIFY_FAILED',
          budgetId: result.postCommit.budget.id,
          ownerUserId: result.postCommit.ownerUserId,
          recipientCount: result.postCommit.cleanup.recipients.length,
        },
      );
    }
  }

  return { success: result.success };
};

const deleteBudgetInTx = withTransaction(
  async ({ id, userId }: DeleteBudgetPayload): Promise<DeleteBudgetInTxResult> => {
    // Owner-only. Recipients (even `manage`) cannot delete — the budget belongs to the
    // owner's namespace. Explicit `userId === budget.userId` check (vs `authorizeBudgetAccess`)
    // because the auth helper would return `404` for non-owners with `manage` access, which
    // is the right outcome but reads less obviously than the direct ownership check.
    const budget = await Budgets.findOne({ where: { id, userId } });

    if (!budget) {
      // Distinguish "budget exists but caller is not the owner" from "budget truly gone".
      // Non-owners (even `manage` recipients) must get 404 (existence-mask) rather than a
      // silent success — otherwise the caller has no idea the delete was a no-op.
      const exists = await Budgets.findByPk(id, { attributes: ['id'] });
      if (exists) {
        throw new NotFoundError({ message: t({ key: 'budgets.budgetNotFound' }) });
      }
      // Budget genuinely absent — idempotent delete is fine.
      return { success: true, postCommit: null };
    }

    // Capture name + cleanup state *before* the destroy so the post-commit notification has
    // something to render and the recipient list isn't already gone.
    const cleanup = await cleanupBudgetSharesInTx({ budgetId: id, ownerUserId: userId });

    // BudgetTransactions rows are deleted explicitly so the destroy order matches the
    // pre-share semantics. Once the budget row goes, FK CASCADE from `budgetId` would also
    // remove these — but the explicit destroy keeps the intent obvious in the diff.
    await BudgetTransactions.destroy({ where: { budgetId: id } });
    if (budget.logoImageId) await deleteLogoImage({ id: budget.logoImageId });
    await budget.destroy();

    return {
      success: true,
      postCommit: {
        cleanup,
        budget: { id: budget.id, name: budget.name },
        ownerUserId: userId,
      },
    };
  },
);

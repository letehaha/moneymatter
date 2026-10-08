import { type BulkUpdateTagMode, TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { NotFoundError, ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import Payees from '@models/payees.model';
import Tags from '@models/tags.model';
import * as Transactions from '@models/transactions.model';
import { getUserDefaultCategory } from '@models/users.model';
import { DOMAIN_EVENTS, eventBus } from '@services/common/event-bus';
import { Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';
import { buildManualCategorizationMeta } from './manual-categorization-meta';

interface BulkUpdateParams {
  userId: number;
  transactionIds: string[];
  categoryId?: string;
  tagIds?: string[];
  tagMode?: BulkUpdateTagMode;
  note?: string;
  // Nullable: explicit `null` clears the Payee on each affected row, `undefined`
  // leaves it untouched. Payee writes are restricted to transactions on
  // accounts owned by the caller — shared-account rows are silently skipped to
  // match the per-owner Payee namespace.
  payeeId?: string | null;
}

interface BulkUpdateResult {
  updatedCount: number;
  updatedIds: string[];
}

export const bulkUpdate = withTransaction(
  async ({
    userId,
    transactionIds,
    categoryId,
    tagIds,
    tagMode = 'add',
    note,
    payeeId,
  }: BulkUpdateParams): Promise<BulkUpdateResult> => {
    // Validate at least one field is being updated
    const hasCategory = categoryId !== undefined;
    const hasTags = tagIds !== undefined;
    const hasNote = note !== undefined;
    const hasPayee = payeeId !== undefined;

    if (!hasCategory && !hasTags && !hasNote && !hasPayee) {
      throw new ValidationError({
        message: 'At least one field must be provided for bulk update',
      });
    }

    // Validate category if provided
    if (hasCategory) {
      await findOrThrowNotFound({
        query: Categories.findOne({
          where: { id: categoryId, userId },
        }),
        message: 'Category not found',
      });
    }

    // Validate payee if a concrete id is provided (null clears, so no lookup needed).
    if (hasPayee && payeeId !== null) {
      await findOrThrowNotFound({
        query: Payees.findOne({
          where: { id: payeeId, userId },
        }),
        message: 'Payee not found',
      });
    }

    // Validate tags if provided
    if (hasTags && tagIds.length > 0) {
      const userTags = await Tags.findAll({
        where: { userId, id: { [Op.in]: tagIds } },
      });

      if (userTags.length !== tagIds.length) {
        throw new ValidationError({
          message: 'Some tags do not belong to the current user',
        });
      }
    }

    // Fetch transactions to validate ownership and filter out invalid ones
    const transactions = await Transactions.default.findAll({
      where: {
        id: { [Op.in]: transactionIds },
        userId,
      },
      attributes: ['id', 'transferNature', 'accountId', 'categoryId'],
    });

    if (transactions.length === 0) {
      throw new NotFoundError({
        message: 'No valid transactions found',
      });
    }

    // Filter out transfer transactions - they cannot have category updated
    // But they CAN have tags and notes updated
    const nonTransfers = transactions.filter((tx) => tx.transferNature === TRANSACTION_TRANSFER_NATURE.not_transfer);
    const nonTransferIds = nonTransfers.map((tx) => tx.id);

    // Rows already sitting in the target category are left untouched, so a bulk edit
    // that only widens a selection can't restamp what it didn't change.
    const categoryChangedIds = hasCategory
      ? nonTransfers.filter((tx) => tx.categoryId !== categoryId).map((tx) => tx.id)
      : [];

    const allTransactionIds = transactions.map((tx) => tx.id);

    // For category updates, only non-transfer transactions are valid
    if (hasCategory && nonTransferIds.length === 0) {
      throw new ValidationError({
        message: 'No valid transactions to update. Transfer transactions cannot have their category changed.',
      });
    }

    // Payee writes are scoped to transactions on accounts owned by the caller.
    // A user can have created a transaction on someone else's shared account —
    // that row has the caller's `userId` but lives in a different Payee
    // namespace (the account owner's), so we cannot stamp the caller's Payee
    // onto it. Same goes for clearing: silently skip those rows.
    let ownedAccountTxIds: string[] = [];
    if (hasPayee) {
      const candidateAccountIds = Array.from(new Set(transactions.map((tx) => tx.accountId)));
      const ownedAccounts = await Accounts.findAll({
        where: { userId, id: { [Op.in]: candidateAccountIds } },
        attributes: ['id'],
      });
      const ownedAccountIdSet = new Set(ownedAccounts.map((a) => a.id));
      ownedAccountTxIds = transactions.filter((tx) => ownedAccountIdSet.has(tx.accountId)).map((tx) => tx.id);
    }

    // Build update payload for non-relationship fields
    const updatePayload: { categoryId?: string; note?: string } = {};
    if (hasCategory) {
      updatePayload.categoryId = categoryId;
    }
    if (hasNote) {
      updatePayload.note = note;
    }

    // Perform bulk update for category and note
    if (Object.keys(updatePayload).length > 0) {
      // Category can only be updated on non-transfer transactions
      // Note can be updated on all transactions
      if (hasCategory) {
        await Transactions.updateTransactions(
          updatePayload,
          {
            userId,
            id: { [Op.in]: nonTransferIds },
            transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
          },
          { individualHooks: false },
        );
      } else if (hasNote) {
        // Only note update - can apply to all transactions
        await Transactions.updateTransactions(
          { note },
          {
            userId,
            id: { [Op.in]: allTransactionIds },
          },
          { individualHooks: false },
        );
      }
    }

    if (categoryChangedIds.length > 0) {
      await Transactions.updateTransactions(
        {
          categorizationMeta: buildManualCategorizationMeta({
            categoryId: categoryId!,
            defaultCategoryId: await getUserDefaultCategory({ id: userId }),
          }),
        },
        {
          userId,
          id: { [Op.in]: categoryChangedIds },
        },
        { individualHooks: false },
      );
    }

    // Stamp Payee + lock it on every eligible row. Mirrors single-tx update:
    // a manual assign/clear from the UI implicitly flips `payeeLocked` so future
    // syncs and post-sync backfills won't revert the user's choice.
    if (hasPayee && ownedAccountTxIds.length > 0) {
      await Transactions.updateTransactions(
        { payeeId, payeeLocked: true },
        {
          userId,
          id: { [Op.in]: ownedAccountTxIds },
        },
        { individualHooks: false },
      );
    }

    // Handle tags update separately (many-to-many relationship)
    if (hasTags) {
      const fullTransactions = await Transactions.default.findAll({
        where: {
          id: { [Op.in]: allTransactionIds },
          userId,
        },
      });

      for (const tx of fullTransactions) {
        switch (tagMode) {
          case 'replace':
            // Replace all existing tags with new ones
            await tx.$set('tags', tagIds);
            break;
          case 'remove':
            // Remove specified tags from existing ones
            await tx.$remove('tags', tagIds);
            break;
          case 'add':
          default:
            // Add tags to existing ones
            await tx.$add('tags', tagIds);
            break;
        }

        // Tag edits only touch the junction table, so the row needs an explicit
        // timestamp bump for clients to detect the change. It has to be an instance
        // save — Sequelize silently skips a bulk update whose only value is `updatedAt`.
        tx.changed('updatedAt', true);
        await tx.save();
      }

      // Emit event for real-time reminders check (only for add/replace modes)
      if (tagIds.length > 0 && tagMode !== 'remove') {
        eventBus.emit(DOMAIN_EVENTS.TRANSACTIONS_TAGGED, { tagIds, userId });
      }
    }

    // Return the appropriate count based on what was updated. Category remains
    // the primary signal when present; otherwise prefer the Payee-restricted
    // set (owned accounts only) when Payee was the trigger; fall back to the
    // full set for tag/note-only updates.
    let updatedIds: string[];
    if (hasCategory) {
      updatedIds = nonTransferIds;
    } else if (hasPayee && !hasTags && !hasNote) {
      updatedIds = ownedAccountTxIds;
    } else {
      updatedIds = allTransactionIds;
    }

    return {
      updatedCount: updatedIds.length,
      updatedIds,
    };
  },
);

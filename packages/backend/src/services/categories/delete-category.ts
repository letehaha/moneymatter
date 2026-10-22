import { API_ERROR_CODES } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { ConflictError, ValidationError } from '@js/errors';
import * as Categories from '@models/categories.model';
import TrackerCategories from '@models/tracker-categories.model';
import TrackerLineCategories from '@models/tracker-line-categories.model';
import TrackerLines from '@models/tracker-lines.model';
import TransactionTemplates from '@models/transaction-templates.model';
import { updateTransactions } from '@models/transactions-query';
import { mergeLinesOnCategoryDelete } from '@services/budget-plans/merge-lines-on-category-delete';
import { withTransaction } from '@services/common/with-transaction';
import { disableEmptyTrackerRules } from '@services/trackers/rules/disable-empty-tracker-rules';
import { pauseAutomationsReferencing, rewriteAutomationRef } from '@services/transaction-automations/references';
import { repointSplits } from '@services/transactions/splits/repoint-splits';
import { Op } from 'sequelize';

import { countCategoryTransactions } from './count-category-transactions';

interface DeleteCategoryPayload extends Categories.DeleteCategoryPayload {
  replaceWithCategoryId?: string;
}

/** Rows of trackers that already track the replacement are left to cascade away with the category. */
const repointTrackerCategoriesOnCategoryDelete = async ({
  categoryId,
  replacementCategoryId,
}: {
  categoryId: string;
  replacementCategoryId: string;
}): Promise<void> => {
  const holders = await TrackerCategories.findAll({
    where: { categoryId: replacementCategoryId },
    attributes: ['trackerId'],
  });
  await TrackerCategories.update(
    { categoryId: replacementCategoryId },
    { where: { categoryId, trackerId: { [Op.notIn]: holders.map((row) => row.trackerId) } } },
  );
};

/** Without a replacement, a tracker line left with no categories is deleted. */
const mergeTrackerLinesOnCategoryDelete = async ({
  categoryId,
  replacementCategoryId,
}: {
  categoryId: string;
  replacementCategoryId: string | null;
}): Promise<void> => {
  const rows = await TrackerLineCategories.findAll({ where: { categoryId }, attributes: ['lineId'] });
  const lineIds = rows.map((row) => row.lineId);
  if (!lineIds.length) return;

  if (replacementCategoryId) {
    const holders = await TrackerLineCategories.findAll({
      where: { lineId: { [Op.in]: lineIds }, categoryId: replacementCategoryId },
      attributes: ['lineId'],
    });
    const holderIds = new Set(holders.map((row) => row.lineId));
    const repointIds = lineIds.filter((lineId) => !holderIds.has(lineId));
    if (repointIds.length) {
      await TrackerLineCategories.update(
        { categoryId: replacementCategoryId },
        { where: { categoryId, lineId: { [Op.in]: repointIds } } },
      );
    }
    return;
  }

  const survivors = await TrackerLineCategories.findAll({
    where: { lineId: { [Op.in]: lineIds }, categoryId: { [Op.ne]: categoryId } },
    attributes: ['lineId'],
  });
  const survivorIds = new Set(survivors.map((row) => row.lineId));
  const emptiedIds = lineIds.filter((lineId) => !survivorIds.has(lineId));
  if (emptiedIds.length) await TrackerLines.destroy({ where: { id: { [Op.in]: emptiedIds } } });
};

export const deleteCategory = withTransaction(async (payload: DeleteCategoryPayload) => {
  const category = await findOrThrowNotFound({
    query: Categories.default.findOne({ where: { id: payload.categoryId, userId: payload.userId } }),
    message: 'Category with provided id does not exist.',
  });

  if (payload.replaceWithCategoryId === payload.categoryId) {
    throw new ValidationError({ message: 'Replacement category must differ from the deleted one.' });
  }

  const parentCategory = await Categories.default.findOne({
    where: { parentId: payload.categoryId },
  });

  if (parentCategory) {
    throw new ValidationError({
      message:
        'For now you cannot delete category that is a parent for any subcategory. You need to delete all its subcategories first.',
    });
  }

  // Every row pointing at the category must be reassigned before it is dropped: the FKs are
  // SET NULL / CASCADE, so anything this count misses is silently uncategorized or deleted.
  const transactionCount = await countCategoryTransactions({ categoryId: category.id, userId: payload.userId });

  const replacement = payload.replaceWithCategoryId
    ? await findOrThrowNotFound({
        query: Categories.default.findOne({
          where: { id: payload.replaceWithCategoryId, userId: payload.userId },
        }),
        message: 'Replacement category does not exist.',
      })
    : null;

  if (transactionCount > 0) {
    if (!replacement) {
      throw new ConflictError({
        code: API_ERROR_CODES.categoryHasTransactions,
        message: 'Category has linked transactions that need to be reassigned.',
        details: { transactionCount },
      });
    }

    await updateTransactions({
      values: { categoryId: replacement.id },
      where: { categoryId: payload.categoryId },
      planned: 'include',
      access: { creator: payload.userId },
      balanceAdjustments: 'include',
      paranoid: false,
    });
  }

  // Without a successor the rules would silently lose their category action, so they are paused.
  if (replacement) {
    await repointSplits({ from: category.id, to: replacement.id });
    await rewriteAutomationRef({
      userId: payload.userId,
      refType: 'category',
      from: category.id,
      to: replacement.id,
    });
    await TransactionTemplates.update(
      { categoryId: replacement.id },
      { where: { userId: payload.userId, categoryId: category.id } },
    );
  } else {
    await pauseAutomationsReferencing({
      userId: payload.userId,
      refType: 'category',
      refId: category.id,
      label: category.name,
    });
  }

  // Before the delete: the budget membership FK cascades, so a line's coverage
  // and its amounts would be gone before the merge could move them.
  await mergeLinesOnCategoryDelete({
    userId: payload.userId,
    categoryId: category.id,
    replacementCategoryId: replacement?.id ?? null,
  });
  await mergeTrackerLinesOnCategoryDelete({ categoryId: category.id, replacementCategoryId: replacement?.id ?? null });
  if (replacement) {
    await repointTrackerCategoriesOnCategoryDelete({ categoryId: category.id, replacementCategoryId: replacement.id });
  }

  await Categories.deleteCategory(payload);
  await disableEmptyTrackerRules({ userId: payload.userId });
});

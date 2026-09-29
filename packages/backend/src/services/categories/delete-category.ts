import { API_ERROR_CODES } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { ConflictError, ValidationError } from '@js/errors';
import * as Categories from '@models/categories.model';
import TransactionTemplates from '@models/transaction-templates.model';
import { updateTransactions } from '@models/transactions-query';
import { withTransaction } from '@services/common/with-transaction';
import { pauseAutomationsReferencing, rewriteAutomationRef } from '@services/transaction-automations/references';
import { repointSplits } from '@services/transactions/splits/repoint-splits';

import { countCategoryTransactions } from './count-category-transactions';

interface DeleteCategoryPayload extends Categories.DeleteCategoryPayload {
  replaceWithCategoryId?: string;
}

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

  await Categories.deleteCategory(payload);
});

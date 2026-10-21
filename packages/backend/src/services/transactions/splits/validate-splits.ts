import type { RecordId } from '@bt/shared/types';
import { TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import Categories from '@models/categories.model';

import {
  MAX_SPLITS_PER_TRANSACTION,
  MAX_SPLIT_NOTE_LENGTH,
  SPLIT_ERROR_CODES,
  SplitInput,
  SplitValidationError,
} from './types';

interface ValidateSplitsParams {
  splits: SplitInput[];
  transactionAmount: Money;
  /**
   * UserId that owns the *categories* the split rows reference. For owned-account writes
   * this equals the caller; for recipient writes on a shared account it's the account
   * owner (categories on shared accounts are owner-scoped, see family-sharing PRD).
   */
  categoryOwnerUserId: number;
  transferNature?: TRANSACTION_TRANSFER_NATURE;
  /** Smallest amount a split may hold: one unit of the transaction currency's last decimal. */
  minSplitAmount: Money;
}

/**
 * Validates split data for a transaction.
 * Returns an array of validation errors (empty if valid).
 */
const validateSplits = async ({
  splits,
  transactionAmount,
  categoryOwnerUserId,
  transferNature,
  minSplitAmount,
}: ValidateSplitsParams): Promise<SplitValidationError[]> => {
  const errors: SplitValidationError[] = [];

  // Check if trying to add splits to a transfer transaction
  if (transferNature && transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) {
    errors.push({
      field: 'splits',
      message: t({ key: 'transactions.splits.splitsOnTransfer' }),
      code: SPLIT_ERROR_CODES.SPLITS_ON_TRANSFER,
    });
    return errors; // Return early, no point validating further
  }

  // Check split count limit
  if (splits.length > MAX_SPLITS_PER_TRANSACTION) {
    errors.push({
      field: 'splits',
      message: t({ key: 'transactions.splits.splitLimitExceeded', variables: { max: MAX_SPLITS_PER_TRANSACTION } }),
      code: SPLIT_ERROR_CODES.SPLIT_LIMIT_EXCEEDED,
    });
  }

  // Validate each split
  const categoryIds = new Set<RecordId>();

  for (let i = 0; i < splits.length; i++) {
    const split = splits[i]!;
    const fieldPrefix = `splits[${i}]`;

    // Check required fields
    if (split.categoryId === undefined || split.categoryId === null) {
      errors.push({
        field: `${fieldPrefix}.categoryId`,
        message: t({ key: 'transactions.splits.missingCategory' }),
        code: SPLIT_ERROR_CODES.SPLIT_MISSING_CATEGORY,
      });
    } else {
      // One row per category: the table enforces it, and `manage-splits` relinks refunds by
      // categoryId, so a second row for the same category would steal the first one's refunds.
      if (categoryIds.has(split.categoryId)) {
        errors.push({
          field: `${fieldPrefix}.categoryId`,
          message: t({ key: 'transactions.splits.duplicateCategory' }),
          code: SPLIT_ERROR_CODES.SPLIT_DUPLICATE_CATEGORY,
        });
      }
      categoryIds.add(split.categoryId);
    }

    if (split.amount === undefined || split.amount === null) {
      errors.push({
        field: `${fieldPrefix}.amount`,
        message: t({ key: 'transactions.splits.missingAmount' }),
        code: SPLIT_ERROR_CODES.SPLIT_MISSING_AMOUNT,
      });
    } else {
      // Check for negative amounts
      if (split.amount.isNegative()) {
        errors.push({
          field: `${fieldPrefix}.amount`,
          message: t({ key: 'transactions.splits.amountNegative' }),
          code: SPLIT_ERROR_CODES.SPLIT_AMOUNT_NEGATIVE,
        });
      }
      // Check minimum amount
      else if (split.amount.lessThan(minSplitAmount)) {
        errors.push({
          field: `${fieldPrefix}.amount`,
          message: t({ key: 'transactions.splits.amountTooSmall', variables: { min: minSplitAmount.toNumber() } }),
          code: SPLIT_ERROR_CODES.SPLIT_AMOUNT_TOO_SMALL,
        });
      }
    }

    // Check note length
    if (split.note && split.note.length > MAX_SPLIT_NOTE_LENGTH) {
      errors.push({
        field: `${fieldPrefix}.note`,
        message: t({ key: 'transactions.splits.noteTooLong', variables: { max: MAX_SPLIT_NOTE_LENGTH } }),
        code: SPLIT_ERROR_CODES.SPLIT_NOTE_TOO_LONG,
      });
    }
  }

  // Validate that all categories exist and belong to the *category owner*. For shared
  // accounts this is the account owner — caller-scoped lookup would falsely reject
  // owner-set categories that the recipient legitimately references.
  if (categoryIds.size > 0) {
    const existingCategories = await Categories.findAll({
      where: {
        id: Array.from(categoryIds),
        userId: categoryOwnerUserId,
      },
      attributes: ['id'],
    });

    const existingCategoryIds = new Set(existingCategories.map((c) => c.id));

    for (let i = 0; i < splits.length; i++) {
      const split = splits[i]!;
      if (split.categoryId && !existingCategoryIds.has(split.categoryId)) {
        errors.push({
          field: `splits[${i}].categoryId`,
          message: t({ key: 'transactions.splits.invalidCategory', variables: { categoryId: split.categoryId } }),
          code: SPLIT_ERROR_CODES.SPLIT_INVALID_CATEGORY,
        });
      }
    }
  }

  // Check that total splits don't exceed transaction amount
  const totalSplitAmount = Money.sum(splits.map((split) => split.amount || Money.zero()));
  if (totalSplitAmount.greaterThan(transactionAmount)) {
    errors.push({
      field: 'splits',
      message: t({
        key: 'transactions.splits.exceedTotal',
        variables: { total: totalSplitAmount.toNumber(), transactionAmount: transactionAmount.toNumber() },
      }),
      code: SPLIT_ERROR_CODES.SPLITS_EXCEED_TOTAL,
    });
  }

  return errors;
};

/**
 * Throws a ValidationError if splits are invalid.
 * Used for request validation before processing.
 */
export const assertValidSplits = async (params: ValidateSplitsParams): Promise<void> => {
  const errors = await validateSplits(params);

  if (errors.length > 0) {
    const { ValidationError } = await import('@js/errors');
    throw new ValidationError({
      message: t({ key: 'transactions.splits.invalidData' }),
      // @ts-expect-error - extending error with additional data
      errors,
    });
  }
};

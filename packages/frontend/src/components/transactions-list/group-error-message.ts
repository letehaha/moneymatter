import { getApiErrorMessage, isApiErrorWithCode } from '@/js/errors';
import {
  API_ERROR_CODES,
  type TransactionGroupConflictDetails,
  type TransactionGroupSizeLimitDetails,
} from '@bt/shared/types';

export const getGroupErrorMessage = ({
  e,
  t,
  fallbackKey,
}: {
  e: unknown;
  t: (key: string, named?: Record<string, unknown>) => string;
  fallbackKey: string;
}): string => {
  if (isApiErrorWithCode(e, API_ERROR_CODES.validationError)) {
    const { maxSize, count } = (e.data.details ?? {}) as Partial<TransactionGroupSizeLimitDetails>;
    if (typeof maxSize === 'number' && typeof count === 'number') {
      return t('transactions.transactionGroups.errors.tooManyTransactions', { max: maxSize, count });
    }
  }

  if (isApiErrorWithCode(e, API_ERROR_CODES.conflict)) {
    const groups = (e.data.details as Partial<TransactionGroupConflictDetails> | undefined)?.groups;
    const names = Array.isArray(groups)
      ? groups.map((group) => group?.name).filter((name): name is string => typeof name === 'string')
      : [];
    if (names.length > 0) {
      return t('transactions.transactionGroups.errors.alreadyInNamedGroup', { name: names.join(', ') });
    }
  }

  return getApiErrorMessage({
    e,
    t,
    conflictKey: 'transactions.transactionGroups.errors.alreadyInGroup',
    fallbackKey,
  });
};

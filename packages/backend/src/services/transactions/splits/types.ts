import type { RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';

export interface SplitInput {
  categoryId: RecordId;
  amount: Money;
  refAmount?: Money;
  note?: string | null;
}

export interface SplitValidationError {
  field: string;
  message: string;
  code: string;
}

export const SPLIT_ERROR_CODES = {
  SPLITS_EXCEED_TOTAL: 'SPLITS_EXCEED_TOTAL',
  SPLIT_AMOUNT_TOO_SMALL: 'SPLIT_AMOUNT_TOO_SMALL',
  SPLIT_AMOUNT_NEGATIVE: 'SPLIT_AMOUNT_NEGATIVE',
  SPLIT_LIMIT_EXCEEDED: 'SPLIT_LIMIT_EXCEEDED',
  SPLIT_INVALID_CATEGORY: 'SPLIT_INVALID_CATEGORY',
  SPLIT_NOTE_TOO_LONG: 'SPLIT_NOTE_TOO_LONG',
  SPLITS_ON_TRANSFER: 'SPLITS_ON_TRANSFER',
  SPLIT_MISSING_CATEGORY: 'SPLIT_MISSING_CATEGORY',
  SPLIT_MISSING_AMOUNT: 'SPLIT_MISSING_AMOUNT',
  SPLIT_DUPLICATE_CATEGORY: 'SPLIT_DUPLICATE_CATEGORY',
} as const;

export const MAX_SPLITS_PER_TRANSACTION = 10;
export const MAX_SPLIT_NOTE_LENGTH = 100;

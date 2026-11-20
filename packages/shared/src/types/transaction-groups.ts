import type { RecordId } from './record-id';

export const TRANSACTION_GROUP_MIN_SIZE = 2;
export const TRANSACTION_GROUP_MAX_SIZE = 500;

export interface TransactionGroupSizeLimitDetails {
  maxSize: number;
  count: number;
}

export interface TransactionGroupConflictDetails {
  transactionIds: RecordId[];
  groups: { id: RecordId; name: string }[];
}

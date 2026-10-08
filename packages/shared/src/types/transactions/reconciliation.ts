import { RecordId } from '../record-id';
import type { TransactionModel } from './transactions';

export const RECONCILIATION_MERGE_MIN = 2;
export const RECONCILIATION_MERGE_MAX = 4;
export const RECONCILIATION_REMOVE_MAX = 500;

export interface ReconciliationRemoveBody {
  transactionIds: RecordId[];
}

export interface ReconciliationMergeBody {
  transactionIds: RecordId[];
  survivorId: RecordId;
}

export interface ReconciliationActionResponse {
  removedIds: RecordId[];
}

export interface ReconciliationRestoreBody {
  transactionIds: RecordId[];
}

export interface ReconciliationRestoreResponse {
  restoredIds: RecordId[];
}

export type ReconciliationHistoryEvent = {
  removedAt: string;
  transactions: TransactionModel[];
} & ({ type: 'merge'; survivor: TransactionModel } | { type: 'remove'; survivor: null });

export interface StuckPendingItem {
  transaction: TransactionModel;
  candidate: TransactionModel | null;
  canCheckWithBank: boolean;
  pendingDays: number;
}

export interface CheckStuckPendingBody {
  accountId: RecordId;
}

export interface CheckStuckPendingResponse {
  bookedCount: number;
  pendingCount: number;
}

export interface KeepAsBookedBody {
  transactionIds: RecordId[];
}

export interface KeepAsBookedResponse {
  updatedIds: RecordId[];
}

import { RecordId } from '../record-id';
import type { TransactionModel } from './transactions';

export const TRANSACTION_TRASH_RETENTION_DAYS = 30;
export const TRANSACTION_TRASH_ACTION_MAX = 500;

export const TRANSACTION_DELETION_REASON = {
  trash: 'trash',
  reconciliation: 'reconciliation',
} as const;
export type TransactionDeletionReason = (typeof TRANSACTION_DELETION_REASON)[keyof typeof TRANSACTION_DELETION_REASON];

export type TrashLinkKind = 'refund' | 'tracker' | 'group' | 'subscription' | 'subscriptionPeriod';

/** A relationship still attached to the trashed row; it comes back as-is on restore. */
export interface TrashLinkPreview {
  kind: TrashLinkKind;
  /** Tracker/group/subscription name, refund counterpart note or payee, period due date. */
  label: string | null;
  /** The linked transaction is in the Trash too, so the link stays hidden until both are restored. */
  counterpartInTrash: boolean;
}

export interface TrashEntry {
  /** Id to pass to restore / delete. For a transfer, any leg id works; the server expands to all legs. */
  id: RecordId;
  deletedAt: string;
  expiresAt: string;
  /** One row for a regular tx, two for a transfer pair whose both legs are trashed. */
  transactions: TransactionModel[];
  /** Account names keyed by accountId, so the UI can label rows on accounts it no longer lists. */
  accountNames: Record<RecordId, string>;
  /** Things that stay attached to the row and always come back. */
  kept: { splits: number; tags: number; attachments: number };
  links: TrashLinkPreview[];
}

export type GetTrashResponse = TrashEntry[];

export interface TrashActionBody {
  transactionIds: RecordId[];
}

export interface RestoreTrashResponse {
  restoredIds: RecordId[];
  /** Refund links dropped on restore because they no longer fit (cap exceeded, counterpart became a transfer/payment). */
  droppedRefundLinks: number;
}

export interface DeleteTrashResponse {
  deletedIds: RecordId[];
}

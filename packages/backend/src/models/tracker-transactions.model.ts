import { RecordId } from '@bt/shared/types';
import { Table, Column, Model, ForeignKey, DataType } from 'sequelize-typescript';

import Trackers from './trackers.model';
import Transactions from './transactions.model';

/**
 * `null` = added by the owner, by hand or by an AI auto-link. `addedByUserId` marks a share recipient's row, so the
 * revoke sweep and the detach check can find it. `source: 'rule'` marks a row the tracker's
 * rules added, the only kind rules cleanup may remove.
 */
export type TrackerTransactionMetadata =
  | { addedByUserId: number; source?: never }
  | { source: 'rule'; addedByUserId?: never };

export const isRuleLinkMetadata = ({ metadata }: { metadata: TrackerTransactionMetadata | null }): boolean =>
  metadata?.source === 'rule';

/** Transactions linked to a tracker. */
@Table({ tableName: 'TrackerTransactions', timestamps: false })
export default class TrackerTransactions extends Model {
  @ForeignKey(() => Trackers)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  trackerId!: RecordId;

  @ForeignKey(() => Transactions)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  transactionId!: RecordId;

  @Column({ allowNull: true, type: DataType.JSONB })
  metadata!: TrackerTransactionMetadata | null;
}

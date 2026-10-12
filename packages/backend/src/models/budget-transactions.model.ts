import { RecordId } from '@bt/shared/types';
import Budgets from '@models/budget.model';
import { Table, Column, Model, ForeignKey, DataType } from 'sequelize-typescript';

import Transactions from './transactions.model';

/**
 * Per-row metadata captured at attach-time. Owner-attached rows leave the column
 * `null` entirely; recipient-attached rows carry a populated `BudgetTransactionMetadata`
 * with `addedByUserId` set so the revoke/leave sweep and the detach-permission check
 * can identify rows the recipient is allowed to touch. `addedByUserId` is required
 * (not optional) — a present metadata object without it is meaningless and would be
 * indistinguishable from `null`; the model column carries the recipient/owner
 * discriminator, not the field's optionality. Kept as a JSONB blob (not a typed
 * column) so future attributes can land without another migration.
 */
export interface BudgetTransactionMetadata {
  addedByUserId: number;
}

/** Transactions hand-picked into a `Budgets` row, the user-facing "Tracker". Budget plans link nothing here. */
@Table({ tableName: 'BudgetTransactions', timestamps: false })
export default class BudgetTransactions extends Model {
  @ForeignKey(() => Budgets)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  budgetId!: RecordId;

  @ForeignKey(() => Transactions)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  transactionId!: RecordId;

  @Column({ allowNull: true, type: DataType.JSONB })
  metadata!: BudgetTransactionMetadata | null;
}

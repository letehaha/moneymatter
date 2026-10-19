import { RecordId, TRACKER_SUGGESTION_STATUS } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType } from 'sequelize-typescript';

import Budgets from './budget.model';
import Transactions from './transactions.model';

/** A smart tracking verdict on one transaction for one tracker. Rejected rows keep the AI from asking again. */
@Table({ tableName: 'TrackerSuggestions', timestamps: false, freezeTableName: true })
export default class TrackerSuggestions extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Budgets)
  @Column({ type: DataType.UUID, allowNull: false })
  budgetId!: RecordId;

  @ForeignKey(() => Transactions)
  @Column({ type: DataType.UUID, allowNull: false })
  transactionId!: RecordId;

  @Column({ type: DataType.FLOAT, allowNull: false })
  score!: number;

  @Column({ type: DataType.TEXT, allowNull: false })
  reason!: string;

  @Column({ type: DataType.STRING(16), allowNull: false })
  status!: TRACKER_SUGGESTION_STATUS;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  createdAt!: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  resolvedAt!: Date | null;

  @BelongsTo(() => Budgets, { foreignKey: 'budgetId', onDelete: 'CASCADE' })
  budget?: Budgets;

  @BelongsTo(() => Transactions, { foreignKey: 'transactionId', onDelete: 'CASCADE' })
  transaction?: Transactions;
}

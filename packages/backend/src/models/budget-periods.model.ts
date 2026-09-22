import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, HasMany, DataType, Index } from 'sequelize-typescript';

import BudgetAssignments from './budget-assignments.model';
import BudgetPlans from './budget-plans.model';

@Table({
  tableName: 'BudgetPeriods',
  timestamps: true,
  freezeTableName: true,
})
export default class BudgetPeriods extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => BudgetPlans)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  planId!: RecordId;

  /** Inclusive. */
  @Column({ type: DataType.DATEONLY, allowNull: false })
  startDate!: string;

  /** Exclusive, equals the next period's start. */
  @Column({ type: DataType.DATEONLY, allowNull: false })
  endDate!: string;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => BudgetPlans, { foreignKey: 'planId', onDelete: 'CASCADE' })
  plan?: BudgetPlans;

  @HasMany(() => BudgetAssignments, { foreignKey: 'periodId', onDelete: 'CASCADE' })
  assignments?: BudgetAssignments[];
}

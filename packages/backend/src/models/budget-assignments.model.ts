import { BudgetPlanCarryPolicy, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType, Index } from 'sequelize-typescript';

import BudgetLines from './budget-lines.model';
import BudgetPeriods from './budget-periods.model';

/**
 * One row per (period, line), only where the user typed something. A DB CHECK
 * rejects an all-NULL row.
 */
@Table({
  tableName: 'BudgetAssignments',
  timestamps: true,
  freezeTableName: true,
})
export default class BudgetAssignments extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => BudgetPeriods)
  @Column({ type: DataType.UUID, allowNull: false })
  periodId!: RecordId;

  @ForeignKey(() => BudgetLines)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  lineId!: RecordId;

  /** From this period on. */
  @MoneyField({ storage: 'cents', allowNull: true })
  declare baselineAmount: Money | null;

  /** This period only. */
  @MoneyField({ storage: 'cents', allowNull: true })
  declare overrideAmount: Money | null;

  /** Carry into this period and later; NULL = inherit the earlier setting. */
  @Column({ type: DataType.STRING(20), allowNull: true })
  carryPolicy!: BudgetPlanCarryPolicy | null;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => BudgetPeriods, { foreignKey: 'periodId', onDelete: 'CASCADE' })
  period?: BudgetPeriods;

  @BelongsTo(() => BudgetLines, { foreignKey: 'lineId', onDelete: 'CASCADE' })
  line?: BudgetLines;
}

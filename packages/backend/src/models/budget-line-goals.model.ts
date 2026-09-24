import { BudgetLineGoalBehavior, BudgetLineGoalFrequency, BudgetLineGoalRepeatUnit, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType } from 'sequelize-typescript';

import BudgetLines from './budget-lines.model';

@Table({
  tableName: 'BudgetLineGoals',
  timestamps: true,
  freezeTableName: true,
})
export default class BudgetLineGoals extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => BudgetLines)
  @Column({ type: DataType.UUID, allowNull: false, unique: true })
  lineId!: RecordId;

  @Column({ type: DataType.STRING(20), allowNull: false })
  frequency!: BudgetLineGoalFrequency;

  @Column({ type: DataType.STRING(20), allowNull: false })
  behavior!: BudgetLineGoalBehavior;

  @MoneyField({ storage: 'cents' })
  declare amount: Money;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  weekday!: number | null;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  anchorDate!: string | null;

  @Column({ type: DataType.SMALLINT, allowNull: true })
  repeatEvery!: number | null;

  @Column({ type: DataType.STRING(10), allowNull: true })
  repeatUnit!: BudgetLineGoalRepeatUnit | null;

  @MoneyField({ storage: 'cents', allowNull: true })
  declare stopAtBalance: Money | null;

  @MoneyField({ storage: 'cents', allowNull: true })
  declare fundingCap: Money | null;

  @Column({ type: DataType.DATEONLY, allowNull: false })
  startPeriodStart!: string;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  snoozedPeriodStart!: string | null;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => BudgetLines, { foreignKey: 'lineId', onDelete: 'CASCADE' })
  line?: BudgetLines;
}

import { BudgetPlanCadence, BudgetPlanCarryPolicy, BudgetPlanTypeKey, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, HasMany, DataType, Index } from 'sequelize-typescript';

import BudgetLines from './budget-lines.model';
import BudgetPeriods from './budget-periods.model';
import BudgetPlanAccounts from './budget-plan-accounts.model';
import Users from './users.model';

@Table({
  tableName: 'BudgetPlans',
  timestamps: true,
  paranoid: true,
  freezeTableName: true,
})
export default class BudgetPlans extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Index
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @Column({ type: DataType.STRING(200), allowNull: false })
  name!: string;

  @Column({ type: DataType.STRING(50), allowNull: false })
  type!: BudgetPlanTypeKey;

  /** Base currency at creation; assigned amounts are cents in it. */
  @Column({ type: DataType.STRING(3), allowNull: false })
  currencyCode!: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  cadence!: BudgetPlanCadence;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 1 })
  intervalN!: number;

  @Column({ type: DataType.DATEONLY, allowNull: false })
  anchorDate!: string;

  @Column({ type: DataType.INTEGER, allowNull: true })
  secondAnchorDay!: number | null;

  /** First budgeted day, always a period start. */
  @Column({ type: DataType.DATEONLY, allowNull: false })
  epochDate!: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  carryPolicy!: BudgetPlanCarryPolicy;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  autoAttachAccounts!: boolean;

  declare createdAt: Date;
  declare updatedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare deletedAt: Date | null;

  @BelongsTo(() => Users)
  user?: Users;

  @HasMany(() => BudgetLines, { foreignKey: 'planId', onDelete: 'CASCADE' })
  lines?: BudgetLines[];

  @HasMany(() => BudgetPeriods, { foreignKey: 'planId', onDelete: 'CASCADE' })
  periods?: BudgetPeriods[];

  @HasMany(() => BudgetPlanAccounts, { foreignKey: 'planId', onDelete: 'CASCADE' })
  planAccounts?: BudgetPlanAccounts[];
}

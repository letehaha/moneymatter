import {
  BudgetPlanCadence,
  BudgetPlanCarryPolicy,
  BudgetPlanModel,
  BudgetPlanTypeKey,
  RecordId,
} from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, BelongsTo, HasMany, DataType, Index } from 'sequelize-typescript';

import BudgetLines from './budget-lines.model';
import BudgetPeriods from './budget-periods.model';
import BudgetPlanAccounts from './budget-plan-accounts.model';
import Users from './users.model';

/**
 * Shown to users as the "Budget". The `Budgets` table (`budget.model.ts`) is a
 * different feature, shown as "Trackers".
 */
@Table({
  tableName: 'BudgetPlans',
  timestamps: true,
  paranoid: true,
  freezeTableName: true,
})
export default class BudgetPlans
  extends Model
  implements Omit<BudgetPlanModel, 'expectedIncome' | 'createdAt' | 'updatedAt' | 'deletedAt'>
{
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

  /** First pool period start; `null` = no pool. */
  @Column({ type: DataType.DATEONLY, allowNull: true })
  poolFrom!: string | null;

  /** Keep Ready to Assign at 0. A CHECK requires a pool. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  zeroSum!: boolean;

  @MoneyField({ storage: 'cents', allowNull: true })
  declare expectedIncome: Money | null;

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

import { GOAL_NAME_MAX_LENGTH, GOAL_REACHED_HOLD_DAYS_DEFAULT, GoalStatus, RecordId } from '@bt/shared/types';
import { CURRENCY_CODE_MAX_LENGTH } from '@common/lib/currency-code-columns';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, BelongsTo, HasMany, DataType, Index } from 'sequelize-typescript';

import Currencies from './currencies.model';
import GoalAccounts from './goal-accounts.model';
import Users from './users.model';

/** Savings goal backed by shares or fixed amounts of the user's accounts. Envelope line goals are `BudgetLineGoals`. */
@Table({
  tableName: 'Goals',
  timestamps: true,
  freezeTableName: true,
})
export default class Goals extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Index
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @Column({ type: DataType.STRING(GOAL_NAME_MAX_LENGTH), allowNull: false })
  name!: string;

  @ForeignKey(() => Currencies)
  @Column({ type: DataType.STRING(CURRENCY_CODE_MAX_LENGTH), allowNull: false })
  currencyCode!: string;

  @MoneyField()
  declare targetAmount: Money;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  targetDate!: string | null;

  @MoneyField({ allowNull: true })
  declare plannedMonthly: Money | null;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'active' })
  status!: GoalStatus;

  /** Set together with `achievedAmount`; a DB CHECK enforces it. */
  @Column({ type: DataType.DATE, allowNull: true })
  achievedAt!: Date | null;

  @MoneyField({ allowNull: true })
  declare achievedAmount: Money | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: GOAL_REACHED_HOLD_DAYS_DEFAULT })
  reachedHoldDays!: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  sortOrder!: number;

  @Column({ type: DataType.STRING(253), allowNull: true })
  logoDomain!: string | null;

  @Column({ type: DataType.STRING(16), allowNull: true })
  logoInitials!: string | null;

  @Column({ type: DataType.STRING(7), allowNull: true })
  logoColor!: string | null;

  @Column({ type: DataType.STRING(64), allowNull: true })
  logoIcon!: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  logoImageId!: string | null;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => Users)
  user?: Users;

  @HasMany(() => GoalAccounts, { foreignKey: 'goalId', onDelete: 'CASCADE' })
  goalAccounts?: GoalAccounts[];
}

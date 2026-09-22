import { RecordId } from '@bt/shared/types';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType, Index } from 'sequelize-typescript';

import Accounts from './accounts.model';
import BudgetPlans from './budget-plans.model';

/** The account set defines the plan's world: only its transactions count as activity. */
@Table({
  tableName: 'BudgetPlanAccounts',
  timestamps: false,
  freezeTableName: true,
})
export default class BudgetPlanAccounts extends Model {
  @ForeignKey(() => BudgetPlans)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  planId!: RecordId;

  @ForeignKey(() => Accounts)
  @Index
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  accountId!: RecordId;

  @BelongsTo(() => BudgetPlans, { foreignKey: 'planId', onDelete: 'CASCADE' })
  plan?: BudgetPlans;

  @BelongsTo(() => Accounts, { foreignKey: 'accountId', onDelete: 'CASCADE' })
  account?: Accounts;
}

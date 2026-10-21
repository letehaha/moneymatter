import { RecordId } from '@bt/shared/types';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType, Index } from 'sequelize-typescript';

import Accounts from './accounts.model';
import Goals from './goals.model';

@Table({
  tableName: 'GoalAccounts',
  timestamps: false,
  freezeTableName: true,
})
export default class GoalAccounts extends Model {
  @ForeignKey(() => Goals)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  goalId!: RecordId;

  @ForeignKey(() => Accounts)
  @Index
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  accountId!: RecordId;

  // A percent ratio, not money. Postgres returns DECIMAL as a string.
  @Column({ type: DataType.DECIMAL(5, 2), allowNull: false })
  get sharePercent(): number {
    return Number(this.getDataValue('sharePercent'));
  }
  set sharePercent(val: number) {
    this.setDataValue('sharePercent', val.toFixed(2));
  }

  @BelongsTo(() => Goals, { foreignKey: 'goalId', onDelete: 'CASCADE' })
  goal?: Goals;

  @BelongsTo(() => Accounts, { foreignKey: 'accountId', onDelete: 'CASCADE' })
  account?: Accounts;
}

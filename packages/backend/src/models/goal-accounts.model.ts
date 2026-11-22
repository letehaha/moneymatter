import { RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
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

  /** Exactly one of `sharePercent` and `fixedAmount` is set; a DB CHECK enforces it. */
  // A percent ratio, not money. Postgres returns DECIMAL as a string.
  @Column({ type: DataType.DECIMAL(5, 2), allowNull: true })
  get sharePercent(): number | null {
    const value = this.getDataValue('sharePercent');
    return value === null ? null : Number(value);
  }
  set sharePercent(val: number | null) {
    this.setDataValue('sharePercent', val === null ? null : val.toFixed(2));
  }

  /** In the account's currency. */
  @MoneyField({ allowNull: true })
  declare fixedAmount: Money | null;

  /** Set with `fixedAmount`. */
  @Column({ type: DataType.INTEGER, allowNull: true })
  fixedPosition!: number | null;

  @BelongsTo(() => Goals, { foreignKey: 'goalId', onDelete: 'CASCADE' })
  goal?: Goals;

  @BelongsTo(() => Accounts, { foreignKey: 'accountId', onDelete: 'CASCADE' })
  account?: Accounts;
}

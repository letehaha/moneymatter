import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, HasMany, DataType, Index } from 'sequelize-typescript';

import BudgetLines from './budget-lines.model';
import BudgetPlans from './budget-plans.model';

@Table({
  tableName: 'BudgetLineGroups',
  timestamps: true,
  freezeTableName: true,
})
export default class BudgetLineGroups extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => BudgetPlans)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  planId!: RecordId;

  @Column({ type: DataType.STRING(200), allowNull: false })
  name!: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  sortOrder!: number;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => BudgetPlans, { foreignKey: 'planId', onDelete: 'CASCADE' })
  plan?: BudgetPlans;

  @HasMany(() => BudgetLines, { foreignKey: 'groupId', onDelete: 'SET NULL' })
  lines?: BudgetLines[];
}

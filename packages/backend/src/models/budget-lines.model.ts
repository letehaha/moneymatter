import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, HasMany, DataType, Index } from 'sequelize-typescript';

import BudgetAssignments from './budget-assignments.model';
import BudgetLineCategories from './budget-line-categories.model';
import BudgetPlans from './budget-plans.model';

@Table({
  tableName: 'BudgetLines',
  timestamps: true,
  freezeTableName: true,
})
export default class BudgetLines extends Model {
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

  /** A period start, inclusive. Outside its lifetime a line does not exist. */
  @Column({ type: DataType.DATEONLY, allowNull: false })
  activeFrom!: string;

  /** A period start, exclusive; NULL = still live. */
  @Column({ type: DataType.DATEONLY, allowNull: true })
  activeUntil!: string | null;

  /**
   * The categories an archived line held at its end, which a restore brings back.
   * Kept apart from the membership rows: one added in the archive's own period has no range left to store it.
   */
  @Column({ type: DataType.ARRAY(DataType.UUID), allowNull: false, defaultValue: [] })
  archivedCategoryIds!: RecordId[];

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => BudgetPlans, { foreignKey: 'planId', onDelete: 'CASCADE' })
  plan?: BudgetPlans;

  @HasMany(() => BudgetLineCategories, { foreignKey: 'lineId', onDelete: 'CASCADE' })
  lineCategories?: BudgetLineCategories[];

  @HasMany(() => BudgetAssignments, { foreignKey: 'lineId', onDelete: 'CASCADE' })
  assignments?: BudgetAssignments[];
}

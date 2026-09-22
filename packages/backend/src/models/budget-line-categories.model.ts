import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType, Index } from 'sequelize-typescript';

import BudgetLines from './budget-lines.model';
import Categories from './categories.model';

/**
 * "This line covers this category for the periods `fromDate <= p.startDate <
 * untilDate`".
 */
@Table({
  tableName: 'BudgetLineCategories',
  timestamps: true,
  freezeTableName: true,
})
export default class BudgetLineCategories extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => BudgetLines)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  lineId!: RecordId;

  @ForeignKey(() => Categories)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  categoryId!: RecordId;

  /** A period start, inclusive. */
  @Column({ type: DataType.DATEONLY, allowNull: false })
  fromDate!: string;

  /** A period start, exclusive; NULL = still covered. */
  @Column({ type: DataType.DATEONLY, allowNull: true })
  untilDate!: string | null;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => BudgetLines, { foreignKey: 'lineId', onDelete: 'CASCADE' })
  line?: BudgetLines;

  @BelongsTo(() => Categories, { foreignKey: 'categoryId', onDelete: 'CASCADE' })
  category?: Categories;
}

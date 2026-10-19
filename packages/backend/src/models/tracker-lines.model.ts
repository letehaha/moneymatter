import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, BelongsTo, BelongsToMany, DataType, Index } from 'sequelize-typescript';

import Budgets from './budget.model';
import Categories from './categories.model';
import TrackerLineCategories from './tracker-line-categories.model';

/** A per-category limit inside a tracker (`Budgets`). */
@Table({
  tableName: 'TrackerLines',
  timestamps: true,
  freezeTableName: true,
})
export default class TrackerLines extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Budgets)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  budgetId!: RecordId;

  @Column({ type: DataType.STRING(200), allowNull: false })
  name!: string;

  @MoneyField({ storage: 'cents', allowNull: true })
  declare limitAmount: Money | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  position!: number;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => Budgets, { foreignKey: 'budgetId', onDelete: 'CASCADE' })
  budget?: Budgets;

  @BelongsToMany(() => Categories, {
    through: { model: () => TrackerLineCategories, unique: false },
    foreignKey: 'lineId',
    otherKey: 'categoryId',
  })
  categories!: Categories[];
}

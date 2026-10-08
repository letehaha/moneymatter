import { RecordId } from '@bt/shared/types';
import Budgets from '@models/budget.model';
import { Table, Column, Model, ForeignKey, DataType } from 'sequelize-typescript';

import Tags from './tags.model';

/**
 * Junction table for many-to-many relationship between Budgets and Tags.
 *
 * Mirrors BudgetCategories: allows a tag-based budget to track multiple tags
 * (OR-matched at stats time), and the same tag to be tracked by multiple budgets.
 */
@Table({ tableName: 'BudgetTags', timestamps: false })
export default class BudgetTags extends Model {
  @ForeignKey(() => Budgets)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  budgetId!: RecordId;

  @ForeignKey(() => Tags)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  tagId!: RecordId;
}

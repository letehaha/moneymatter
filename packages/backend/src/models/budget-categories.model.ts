import { RecordId } from '@bt/shared/types';
import Budgets from '@models/budget.model';
import { Table, Column, Model, ForeignKey, DataType } from 'sequelize-typescript';

import Categories from './categories.model';

/**
 * Junction table for many-to-many relationship between Budgets and Categories.
 * `Budgets` are the user-facing "Trackers"; budget plans use `BudgetLineCategories`.
 *
 * This table allows category-based budgets to track multiple categories, and
 * importantly, allows the SAME category to be tracked by MULTIPLE budgets.
 *
 * Example:
 * - Budget "Eating Out" → [Restaurants, Cafes, Bars]
 * - Budget "Entertainment" → [Bars, Movies, Games]
 * Both budgets can track "Bars" category independently.
 *
 * Why junction table instead of JSON array on Budget:
 * - Referential integrity: FK constraints ensure valid category IDs
 * - CASCADE delete: When category is deleted, entries auto-removed
 * - Efficient querying: Easy to find "all budgets tracking category X"
 */
@Table({ tableName: 'BudgetCategories', timestamps: false })
export default class BudgetCategories extends Model {
  @ForeignKey(() => Budgets)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  budgetId!: RecordId;

  @ForeignKey(() => Categories)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  categoryId!: RecordId;
}

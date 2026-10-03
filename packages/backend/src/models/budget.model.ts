import { BUDGET_STATUSES, BUDGET_TYPES, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import Categories from '@models/categories.model';
import Transactions from '@models/transactions.model';
import Users from '@models/users.model';
import { Table, Column, Model, ForeignKey, DataType, BelongsToMany } from 'sequelize-typescript';

import BudgetCategories from './budget-categories.model';
import BudgetTags from './budget-tags.model';
import BudgetTransactions from './budget-transactions.model';
import Tags from './tags.model';

@Table({
  timestamps: false,
})
export default class Budgets extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @Column({ allowNull: false, type: DataType.STRING(200) })
  name!: string;

  @Column({ allowNull: false, type: DataType.ENUM({ values: Object.values(BUDGET_STATUSES) }) })
  status!: BUDGET_STATUSES;

  @Column({
    allowNull: false,
    defaultValue: BUDGET_TYPES.manual,
    type: DataType.ENUM(...Object.values(BUDGET_TYPES)),
  })
  type!: BUDGET_TYPES;

  @Column({ type: DataType.DATE, allowNull: true })
  startDate!: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  endDate!: Date;

  @Column({ defaultValue: false, type: DataType.BOOLEAN })
  autoInclude!: boolean;

  @MoneyField({ storage: 'cents', allowNull: true })
  declare limitAmount: Money;

  @ForeignKey(() => Users)
  @Column({ allowNull: false, type: DataType.INTEGER })
  userId!: number;

  @BelongsToMany(() => Transactions, {
    through: { model: () => BudgetTransactions, unique: false },
    foreignKey: 'budgetId',
    otherKey: 'transactionId',
  })
  transactions!: number[];

  @BelongsToMany(() => Categories, {
    through: { model: () => BudgetCategories, unique: false },
    foreignKey: 'budgetId',
    otherKey: 'categoryId',
  })
  categories!: Categories[];

  @BelongsToMany(() => Tags, {
    through: { model: () => BudgetTags, unique: false },
    foreignKey: 'budgetId',
    otherKey: 'tagId',
  })
  tags!: Tags[];
}

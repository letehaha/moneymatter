import {
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_TYPES,
  TRANSACTION_TYPES,
  SubscriptionMatchingRules,
  RemindBeforePreset,
  LogoResolutionState,
  RecordId,
} from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, BelongsTo, BelongsToMany, HasMany, DataType } from 'sequelize-typescript';

import Accounts from './accounts.model';
import Categories from './categories.model';
import Payees from './payees.model';
import SubscriptionPeriods from './subscription-periods.model';
import SubscriptionTags from './subscription-tags.model';
import SubscriptionTransactions from './subscription-transactions.model';
import Tags from './tags.model';
import Transactions from './transactions.model';
import Users from './users.model';

@Table({
  tableName: 'Subscriptions',
  timestamps: true,
  freezeTableName: true,
})
export default class Subscriptions extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @Column({
    type: DataType.STRING(200),
    allowNull: false,
  })
  name!: string;

  // VARCHAR + TS-side enum (project convention: no DB enums). One of
  // SUBSCRIPTION_TYPES: 'subscription' | 'bill' | 'installment'.
  @Column({
    type: DataType.STRING(50),
    allowNull: false,
    defaultValue: SUBSCRIPTION_TYPES.subscription,
  })
  type!: SUBSCRIPTION_TYPES;

  @Column({
    type: DataType.STRING(50),
    allowNull: false,
    defaultValue: TRANSACTION_TYPES.expense,
  })
  transactionType!: TRANSACTION_TYPES;

  @MoneyField({ storage: 'cents', allowNull: true })
  declare expectedAmount: Money | null;

  @Column({
    type: DataType.STRING(3),
    allowNull: true,
  })
  expectedCurrencyCode!: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(SUBSCRIPTION_FREQUENCIES)),
    allowNull: false,
  })
  frequency!: SUBSCRIPTION_FREQUENCIES;

  @Column({
    type: DataType.DATEONLY,
    allowNull: false,
  })
  startDate!: string;

  @Column({
    type: DataType.DATEONLY,
    allowNull: true,
  })
  endDate!: string | null;

  @ForeignKey(() => Accounts)
  @Column({
    type: DataType.UUID,
    allowNull: true,
  })
  accountId!: RecordId | null;

  @ForeignKey(() => Categories)
  @Column({
    type: DataType.UUID,
    allowNull: true,
  })
  categoryId!: RecordId | null;

  @ForeignKey(() => Payees)
  @Column({
    type: DataType.UUID,
    allowNull: true,
  })
  payeeId!: RecordId | null;

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: { rules: [] },
  })
  matchingRules!: SubscriptionMatchingRules;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  })
  isActive!: boolean;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  notes!: string | null;

  @Column({
    type: DataType.DATEONLY,
    allowNull: true,
  })
  dueDate!: string | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  anchorDay!: number | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  maxOccurrences!: number | null;

  // Set when an installment consumes its full schedule (paid/skipped all
  // maxOccurrences periods); the engine deactivates it at the same time. Null
  // for open installments and for subscriptions/bills. Lets a finished
  // installment be told apart from a manually paused one (both isActive=false).
  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  completedAt!: Date | null;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  })
  showInWidget!: boolean;

  // When true, the hourly auto-record cron creates the expense transaction for
  // the next due period and marks it paid. Cannot coexist with matchingRules
  // (DB CHECK enforces) — both routes would race to book the same period.
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  autoRecord!: boolean;

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
  })
  remindBefore!: RemindBeforePreset[];

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  notifyEmail!: boolean;

  @Column({
    type: DataType.STRING(253),
    allowNull: true,
  })
  logoDomain!: string | null;

  // VARCHAR + TS-side union (project convention: no DB enums). 'auto' =
  // system-resolved via BrandLogos; 'manual' = user override; null = unresolved.
  @Column({
    type: DataType.STRING(16),
    allowNull: true,
  })
  logoSource!: LogoResolutionState;

  // 1-2 graphemes rendered as a monogram instead of a logo.dev image. 16 chars
  // because one grapheme can span many code points; the count is enforced in Zod.
  @Column({
    type: DataType.STRING(16),
    allowNull: true,
  })
  logoInitials!: string | null;

  // '#rrggbb' lowercase, the monogram background. Only meaningful alongside
  // logoInitials; null there falls back to the primary tint.
  @Column({
    type: DataType.STRING(7),
    allowNull: true,
  })
  logoColor!: string | null;

  @Column({
    type: DataType.STRING(64),
    allowNull: true,
  })
  logoIcon!: string | null;

  @Column({
    type: DataType.UUID,
    allowNull: true,
  })
  logoImageId!: string | null;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => Users)
  user!: Users;

  @BelongsTo(() => Accounts)
  account!: Accounts;

  @BelongsTo(() => Categories)
  category!: Categories;

  @BelongsTo(() => Payees)
  payee!: Payees;

  @BelongsToMany(() => Tags, {
    through: () => SubscriptionTags,
    foreignKey: 'subscriptionId',
    otherKey: 'tagId',
    as: 'tags',
  })
  tags?: Tags[];

  @BelongsToMany(() => Transactions, {
    through: { model: () => SubscriptionTransactions, unique: false },
    foreignKey: 'subscriptionId',
    otherKey: 'transactionId',
  })
  transactions!: Transactions[];

  @HasMany(() => SubscriptionPeriods, { foreignKey: 'subscriptionId' })
  periods!: SubscriptionPeriods[];
}

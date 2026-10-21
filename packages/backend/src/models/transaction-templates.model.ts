import { PAYMENT_TYPES, RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { CURRENCY_CODE_MAX_LENGTH } from '@common/lib/currency-code-columns';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { BelongsTo, BelongsToMany, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

import Accounts from './accounts.model';
import Categories from './categories.model';
import Currencies from './currencies.model';
import Payees from './payees.model';
import Tags from './tags.model';
import TransactionTemplateTags from './transaction-template-tags.model';
import Users from './users.model';

@Table({
  tableName: 'TransactionTemplates',
  timestamps: true,
  freezeTableName: true,
})
export default class TransactionTemplates extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @Column({
    type: DataType.STRING(100),
    allowNull: false,
  })
  name!: string;

  // VARCHAR + TS-side enum (project convention: no DB enums).
  @Column({
    type: DataType.STRING(50),
    allowNull: false,
  })
  transactionType!: TRANSACTION_TYPES;

  /** Null means the user types the amount each time. Non-null requires `accountId`. */
  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, allowNull: true })
  declare amount: Money | null;

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
    type: DataType.STRING(50),
    allowNull: true,
  })
  paymentType!: PAYMENT_TYPES | null;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  note!: string | null;

  @ForeignKey(() => Currencies)
  @Column({ allowNull: true, defaultValue: null, type: DataType.STRING(CURRENCY_CODE_MAX_LENGTH) })
  originalCurrencyCode!: string | null;

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
    through: () => TransactionTemplateTags,
    foreignKey: 'templateId',
    otherKey: 'tagId',
    as: 'tags',
  })
  tags?: Tags[];
}

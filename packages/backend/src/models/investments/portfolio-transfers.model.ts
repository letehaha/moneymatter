import { RecordId } from '@bt/shared/types';
import { CURRENCY_CODE_MAX_LENGTH } from '@common/lib/currency-code-columns';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, DataType, ForeignKey, BelongsTo, Index } from 'sequelize-typescript';

import Accounts from '../accounts.model';
import Currencies from '../currencies.model';
import Transactions from '../transactions.model';
import Users from '../users.model';
import Portfolios from './portfolios.model';

@Table({
  timestamps: true,
  tableName: 'PortfolioTransfers',
})
export default class PortfolioTransfers extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Index
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @ForeignKey(() => Accounts)
  @Index
  @Column({ type: DataType.UUID, allowNull: true })
  fromAccountId!: RecordId | null;

  @ForeignKey(() => Portfolios)
  @Index
  @Column({ type: DataType.UUID, allowNull: true })
  toPortfolioId!: RecordId | null;

  @ForeignKey(() => Portfolios)
  @Index
  @Column({ type: DataType.UUID, allowNull: true })
  fromPortfolioId!: RecordId | null;

  @ForeignKey(() => Accounts)
  @Index
  @Column({ type: DataType.UUID, allowNull: true })
  toAccountId!: RecordId | null;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare amount: Money;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare refAmount: Money;

  @ForeignKey(() => Currencies)
  @Index
  @Column({ type: DataType.STRING(CURRENCY_CODE_MAX_LENGTH), allowNull: false })
  currencyCode!: string;

  @Index
  @Column({ type: DataType.DATEONLY, allowNull: false })
  date!: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  description!: string | null;

  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;

  // Associations
  @BelongsTo(() => Users)
  user?: Users;

  @BelongsTo(() => Accounts, 'fromAccountId')
  fromAccount?: Accounts;

  @BelongsTo(() => Accounts, 'toAccountId')
  toAccount?: Accounts;

  @BelongsTo(() => Portfolios, 'fromPortfolioId')
  fromPortfolio?: Portfolios;

  @BelongsTo(() => Portfolios, 'toPortfolioId')
  toPortfolio?: Portfolios;

  @BelongsTo(() => Currencies, 'currencyCode')
  currency?: Currencies;

  @ForeignKey(() => Currencies)
  @Index
  @Column({ type: DataType.STRING(CURRENCY_CODE_MAX_LENGTH), allowNull: true, defaultValue: null })
  toCurrencyCode!: string | null;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare toAmount: Money | null;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare refToAmount: Money | null;

  @BelongsTo(() => Currencies, 'toCurrencyCode')
  toCurrency?: Currencies;

  @Column({ type: DataType.JSONB, allowNull: true, defaultValue: null })
  metaData!: Record<string, unknown> | null;

  /**
   * The row reconciles recorded cash to reality instead of recording money that
   * crossed the portfolio boundary. Contribution reporting skips it; cash and
   * balance reconstruction still counts it, because the money did move.
   */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  isAdjustment!: boolean;

  /**
   * False when the portfolio's stored cash already included this money before
   * the transfer was recorded (backfilled transfer). Contribution reporting
   * counts it; the cash balance and cash-history replay skip it.
   */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  affectsCash!: boolean;

  @ForeignKey(() => Transactions)
  @Index
  @Column({ type: DataType.UUID, allowNull: true, defaultValue: null, onDelete: 'SET NULL' })
  transactionId!: RecordId | null;

  @BelongsTo(() => Transactions)
  transaction?: Transactions;
}

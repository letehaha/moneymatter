import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, RecordId } from '@bt/shared/types';
import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, DataType, BelongsTo, Index } from 'sequelize-typescript';

import Portfolios from './portfolios.model';
import Securities from './securities.model';

@Table({
  timestamps: true,
  tableName: 'InvestmentTransactions',
})
export default class InvestmentTransaction extends Model {
  /**
   * IMPORTANT: Investment transactionType Logic
   *
   * The relationship between `category` and `transactionType` represents CASH FLOW direction:
   *
   * BUY transactions:
   * - category: INVESTMENT_TRANSACTION_CATEGORY.buy
   * - transactionType: TRANSACTION_TYPES.expense
   * - Logic: You are SPENDING money to purchase securities (cash leaves your account)
   * - Example: Buy 100 shares of Apple for $15,000 → Your account balance DECREASES
   *
   * SELL transactions:
   * - category: INVESTMENT_TRANSACTION_CATEGORY.sell
   * - transactionType: TRANSACTION_TYPES.income
   * - Logic: You are RECEIVING money from selling securities (cash enters your account)
   * - Example: Sell 100 shares of Apple for $17,000 → Your account balance INCREASES
   *
   * This might seem counterintuitive since you're "losing" shares when selling, but the
   * transactionType tracks the CASH FLOW, not the security movement. Think of it from
   * your bank account's perspective - selling securities brings money IN (income).
   */

  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Securities)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  securityId!: RecordId;

  // New portfolioId field for portfolio migration
  @ForeignKey(() => Portfolios)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  portfolioId!: RecordId;

  /**
   * The transaction type representing cash flow direction:
   * - EXPENSE: Money leaving your account (BUY transactions)
   * - INCOME: Money entering your account (SELL transactions)
   * See class-level documentation above for detailed explanation.
   */
  @Column({
    type: DataType.ENUM(...Object.values(TRANSACTION_TYPES)),
    allowNull: false,
  })
  transactionType!: TRANSACTION_TYPES;

  /**
   * The moment the trade occurred, stored as a full timestamp (TIMESTAMPTZ).
   * Carries the time of day, so same-day trades order deterministically by when
   * they actually happened rather than by insertion order. Date-only inputs are
   * accepted on write and normalized to UTC midnight.
   */
  @Index
  @Column({ type: DataType.DATE, allowNull: false })
  date!: Date;

  /**
   * A descriptive name or title for the investment transaction, providing a
   * quick overview of the transaction's nature. Same as `note` in `Transactions`
   */
  @Column({ type: DataType.STRING(2000), allowNull: true })
  name!: string | null;

  /**
   * The monetary value involved in the transaction. Depending on the context,
   * this could represent the cost, sale proceeds, or other financial values
   * associated with the transaction. Calculated as quantity * price + fees for
   * buy/fee/tax and quantity * price - fees for sell/dividend.
   */
  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare amount: Money;
  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare refAmount: Money;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare fees: Money;
  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare refFees: Money;

  /**
   * * The quantity of the security involved in the transaction. This is crucial
   * for tracking the changes in holdings as a result of the transaction.
   */
  @MoneyField({ storage: 'decimal', precision: 36, scale: 18 })
  declare quantity: Money;

  /**
   * The price per unit of the security at the time of the transaction.
   * This is used to calculate the total transaction amount and update the cost
   * basis of the holding.
   */
  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare price: Money;
  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare refPrice: Money;

  /**
   * The ISO currency code or standard cryptocurrency code representing the currency
   * in which the transaction was conducted. For cryptocurrencies, this code refers to
   * the specific cryptocurrency involved (e.g., BTC for Bitcoin, ETH for Ethereum).
   */
  @Column({ type: DataType.STRING, allowNull: false, defaultValue: 'USD' })
  currencyCode!: string;

  /**
   * The currency in which cash actually left/entered the brokerage account.
   * Some brokers hold cash in a single currency (e.g. PLN) while securities
   * trade in another (e.g. USD) — price/fees/amount stay in the security's
   * currency (`currencyCode`), the settlement* fields record the real cash leg.
   * Equals `currencyCode` when the trade settled in the security's currency.
   */
  @Column({ type: DataType.STRING, allowNull: false })
  settlementCurrencyCode!: string;

  /**
   * Absolute cash moved in `settlementCurrencyCode`:
   * buy — total paid including fee; sell/dividend — received net of fee;
   * fee/tax — amount charged. Cash balance deltas are derived from this value.
   */
  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare settlementAmount: Money;

  /** Broker fee in `settlementCurrencyCode`. `fees` is this value converted to the security currency at `settlementRate`. */
  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare settlementFees: Money;

  /**
   * Settlement currency units per 1 security currency unit — the broker's
   * effective conversion rate for this trade, derived from what the user
   * actually paid/received. 1 when both legs share a currency.
   * Stored as a decimal string; not a monetary amount, so no Money wrapper.
   */
  @Column({ type: DataType.DECIMAL(20, 10), allowNull: false, defaultValue: '1' })
  settlementRate!: string;

  /**
   * A category that classifies the nature of the investment transaction.
   * This could include types like 'buy', 'sell', 'dividend', 'interest', etc.,
   * providing a clear context for the transaction's purpose and impact on the investment portfolio.
   *
   * IMPORTANT: This field works in conjunction with `transactionType`:
   * - BUY category → EXPENSE transactionType (spending money)
   * - SELL category → INCOME transactionType (receiving money)
   * See class-level documentation for detailed cash flow logic.
   */
  @Column({
    type: DataType.ENUM(...Object.values(INVESTMENT_TRANSACTION_CATEGORY)),
    allowNull: false,
  })
  category!: INVESTMENT_TRANSACTION_CATEGORY;

  /**
   * "transferNature" and "transferId" are used to move funds between different
   * accounts and don't affect income/expense stats.
   */
  @Column({
    type: DataType.STRING(50),
    allowNull: false,
    defaultValue: TRANSACTION_TRANSFER_NATURE.not_transfer,
    validate: { isIn: [Object.values(TRANSACTION_TRANSFER_NATURE)] },
  })
  transferNature!: TRANSACTION_TRANSFER_NATURE;

  // (hash, used to connect two transactions)
  @Column({ type: DataType.STRING, allowNull: true })
  transferId!: string | null;

  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;

  @BelongsTo(() => Securities)
  security!: Securities;

  @BelongsTo(() => Portfolios)
  portfolio?: Portfolios;
}

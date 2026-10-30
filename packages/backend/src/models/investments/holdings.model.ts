import { RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, DataType, ForeignKey, BelongsTo, Index, PrimaryKey } from 'sequelize-typescript';

import Portfolios from './portfolios.model';
import Securities from './securities.model';

/**
 * The Holding model represents individual investments within an investment account.
 * It tracks the specific securities that an account holds, along with the quantity of each security.
 * The current market value of each holding is dynamically calculated using the quantity and
 * the current market prices from the SecurityPricing model. This model is crucial for maintaining
 * a detailed record of a user's investment portfolio. It enables tracking the performance and value
 * of individual investments over time through periodic updates of market prices and real-time
 * portfolio valuation. This facilitates comprehensive portfolio analysis and reporting, providing insights
 * into investment growth and asset allocation.
 *
 * Dynamic Value Calculation:
 * The market value of a security changes over time as its price fluctuates.
 * By referencing the SecurityPricing table, which stores historical and current
 * prices of securities, the application can dynamically calculate the current
 * value of each holding.
 *
 * Historical Performance:
 * To assess the performance of a holding over time, the application can compare
 * historical prices from the SecurityPricing table with the purchase price
 * (potentially stored in the Holding model as cost basis) and the current price.
 *
 * To be super simple, the association looks like that:
 * 1. Account has Holdings.
 * 2. Holding contains Security name, it's value based on prices, and quantity.
 * 3. InvestmentTransaction CRUDs Security inside Holding.
 *
 * **Notes:**
 * 1. No need to store averageCost because we can easily calculate it from by
 * using "costBasis / quantity" formula. That way we simply data storage and
 * always have up to date value
 */

@Table({
  timestamps: true,
  tableName: 'Holdings',
})
export default class Holdings extends Model {
  @PrimaryKey
  @ForeignKey(() => Portfolios)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  portfolioId!: RecordId;

  @PrimaryKey
  @ForeignKey(() => Securities)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  securityId!: RecordId;

  /**
   * The `quantity` field represents the total number of units or shares
   * of the specific security currently held in the investment account. This field is crucial
   * for determining the overall exposure or investment in that particular security. It is used
   * in calculating the total value of the holding by multiplying the quantity with the current
   * market price of the security.
   *
   * Changes in quantity are driven by investment transactions such as buying or
   * selling shares of the security.
   */
  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare quantity: Money;

  /**
   * The `costBasis` field represents the original value or purchase price of an
   * investment in the Holding model.
   * It includes the price paid per unit of the security plus any associated
   * expenses like commissions or fees.
   * This field is vital for calculating capital gains or losses when the
   * investment is sold and for assessing the overall performance of the
   * investment. It also plays a crucial role in determining tax liabilities
   * related to capital gains. The cost basis can be adjusted for corporate
   * actions and other financial events.
   *
   * Example:
   * If an investor bought 100 shares of a company at $10 per share, and they paid
   * a $50 commission, their costBasis for this investment would be:
   * $1,050 (100 shares * $10 + $50 commission).
   *
   * Important:
   * It needs to be recalculated when there are new investment transactions that
   * affect the quantity or value of holding.
   */
  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare costBasis: Money;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare refCostBasis: Money;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: 'USD' })
  currencyCode!: string;

  /**
   * Indicates whether a particular holding should be excluded from certain
   * calculations, analyses, or reports within the application. This can be for
   * various reasons, depending on the specific needs or preferences of the user
   * or the application's functionality.
   */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  excluded!: boolean;

  /** Set when the holding's loss crossed the user's unrealized loss alert; cleared once it recovers, re-arming the alert. */
  @Column({ type: DataType.DATE, allowNull: true })
  declare lossAlertedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;

  @BelongsTo(() => Securities)
  security?: Securities;

  @BelongsTo(() => Portfolios)
  portfolio?: Portfolios;
}

import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, DataType, BelongsTo } from 'sequelize-typescript';

import Securities from './securities.model';

/**
 * Represents the dynamic pricing information of financial securities over time.
 * This table is specifically designed to store time-sensitive data like daily
 * closing prices, and it complements the static data  stored in the Security
 * table. By segregating pricing data from the Security table, the design ensures
 * efficient handling of frequently changing market data, which is crucial for
 * accurate and up-to-date financial analysis and reporting.
 */
@Table({
  timestamps: true,
  tableName: 'SecurityPricings',
  indexes: [
    {
      unique: true,
      fields: ['securityId', 'date'],
      name: 'security_pricing_unique_security_date_idx',
    },
  ],
})
export default class SecurityPricing extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Securities)
  @Column({ type: DataType.UUID, allowNull: false })
  securityId!: RecordId;

  /**
   * The canonical timestamp this pricing row represents. The underlying
   * Postgres column is `TIMESTAMP WITH TIME ZONE` (Sequelize's `DataType.DATE`
   * maps to TIMESTAMPTZ — confusingly named; SQL `DATE` would be `DATEONLY`).
   * The same column supports both daily and intraday cadences:
   *
   *   - Stocks: midnight UTC of the trading day (one row per security per day).
   *   - Crypto: CoinGecko's `last_updated_at` from the batch fetch — the
   *     moment their oracle updated the price. Hourly cron produces multiple
   *     rows per day per coin; the unique (securityId, date) index naturally
   *     dedupes consecutive runs that see the same upstream timestamp.
   */
  @Column({ type: DataType.DATE, allowNull: false })
  date!: Date;

  /**
   * The closing price of the security on the specified date. Closing prices are typically used in
   * financial analysis and reporting as they represent the final price at which the security was traded
   * during the trading session.
   */
  @MoneyField({ precision: 20, scale: 10 })
  declare priceClose: Money;

  /**
   * (Optional) The timestamp indicating the specific time the priceClose was recorded. This is particularly
   * useful when multiple price updates occur within a single day or for real-time price tracking.
   */
  @Column({ type: DataType.DATE, allowNull: true })
  priceAsOf!: Date | null;

  /**
   * (Optional) A field indicating the source of the pricing information. This could be the name of the
   * data provider or the market/exchange from which the price was obtained. This field helps in
   * tracking the reliability and origin of the data.
   */
  @Column({ type: DataType.STRING, allowNull: true })
  source!: string | null;

  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;
  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;

  @BelongsTo(() => Securities)
  security!: Securities;
}

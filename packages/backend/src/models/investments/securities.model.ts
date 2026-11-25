import { RecordId } from '@bt/shared/types';
import { SECURITY_PROVIDER, ASSET_CLASS, SECURITY_TYPE } from '@bt/shared/types/investments';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, DataType, HasMany, Index, BeforeCreate, BeforeUpdate } from 'sequelize-typescript';

import Holdings from './holdings.model';
import InvestmentTransactions from './investment-transaction.model';
import SecurityPricing from './security-pricing.model';

@Table({
  tableName: 'Securities',
  freezeTableName: true,
  timestamps: true,
})
export default class Securities extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @Column({ type: DataType.STRING, allowNull: true })
  name!: string | null;

  @Index
  @Column({ type: DataType.STRING, allowNull: true })
  symbol!: string | null;

  @Column({ type: DataType.STRING, allowNull: false })
  providerSymbol!: string;

  // Symbol the price-sync pipeline queries instead of `providerSymbol`. Set
  // when `providerSymbol` identifies a venue with sparse historical data on
  // Yahoo (e.g. an ISIN-suffix UCITS registration listing like
  // `IE00B53L3W79.IR`) but the same fund trades on another exchange (`SXRT.DE`,
  // `MEUD.PA`, …) under a local ticker with full daily history. Same currency
  // as the row by construction so stored prices remain meaningful against
  // `currencyCode`. NULL for ordinary securities – sync reads `providerSymbol`.
  // Read via the `priceQuerySymbol` getter so call sites don't repeat the
  // `?? providerSymbol` fallback.
  @Column({ type: DataType.STRING(255), allowNull: true })
  priceSourceSymbol!: string | null;

  get priceQuerySymbol(): string {
    return this.priceSourceSymbol ?? this.providerSymbol;
  }

  @Index
  @Column({ type: DataType.STRING, allowNull: true })
  cusip!: string | null;

  @Index
  @Column({ type: DataType.STRING, allowNull: true })
  isin!: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  sharesPerContract!: string | null;

  @Column({ type: DataType.STRING, allowNull: false })
  currencyCode!: string;

  @Column({ type: DataType.STRING, allowNull: true })
  cryptoCurrencyCode!: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  pricingLastSyncedAt!: Date | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  isBrokerageCash!: boolean;

  @Column({ type: DataType.STRING, allowNull: true })
  exchangeAcronym!: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  exchangeMic!: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  exchangeName!: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  logoUrl!: string | null;

  @Column({ type: DataType.STRING, allowNull: false })
  providerName!: SECURITY_PROVIDER;

  @Column({ type: DataType.STRING, allowNull: false })
  assetClass!: ASSET_CLASS;

  @Column({ type: DataType.STRING(32), allowNull: true })
  securityType!: SECURITY_TYPE | null;

  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;

  @HasMany(() => Holdings)
  holdings?: Holdings[];

  @HasMany(() => InvestmentTransactions)
  investmentTransactions?: InvestmentTransactions[];

  @HasMany(() => SecurityPricing)
  pricing?: SecurityPricing[];

  @BeforeCreate
  @BeforeUpdate
  static validateSecurity(instance: Securities) {
    if (!instance.symbol && !instance.cusip && !instance.isin) {
      throw new Error('At least one of symbol, cusip, or isin must be provided');
    }
  }
}

import { RecordId } from '@bt/shared/types';
import { CURRENCY_CODE_MAX_LENGTH } from '@common/lib/currency-code-columns';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, DataType, ForeignKey, BelongsTo, Index, PrimaryKey } from 'sequelize-typescript';

import Currencies from '../currencies.model';
import Portfolios from './portfolios.model';

@Table({
  timestamps: true,
  tableName: 'PortfolioBalances',
})
export default class PortfolioBalances extends Model {
  @PrimaryKey
  @ForeignKey(() => Portfolios)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  portfolioId!: RecordId;

  @PrimaryKey
  @ForeignKey(() => Currencies)
  @Index
  @Column({ type: DataType.STRING(CURRENCY_CODE_MAX_LENGTH), allowNull: false })
  currencyCode!: string;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare availableCash: Money;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare totalCash: Money;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare refAvailableCash: Money;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare refTotalCash: Money;

  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;

  // Associations
  @BelongsTo(() => Portfolios)
  portfolio?: Portfolios;

  @BelongsTo(() => Currencies)
  currency?: Currencies;
}

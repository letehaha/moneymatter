import { RecordId } from '@bt/shared/types';
import { VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE } from '@bt/shared/types/venture';
import { CURRENCY_CODE_MAX_LENGTH } from '@common/lib/currency-code-columns';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { BelongsTo, Column, DataType, ForeignKey, HasMany, Index, Model, Table } from 'sequelize-typescript';

import Currencies from '../currencies.model';
import Users from '../users.model';
import VentureDeals from './venture-deals.model';
import VentureEventLinks from './venture-event-links.model';

@Table({
  timestamps: true,
  tableName: 'VentureEvents',
})
export default class VentureEvents extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Index
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @ForeignKey(() => VentureDeals)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  dealId!: RecordId;

  @Index
  @Column({ type: DataType.STRING(32), allowNull: false })
  type!: VENTURE_EVENT_TYPE;

  @Index
  @Column({ type: DataType.DATEONLY, allowNull: false })
  eventDate!: string;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10, allowNull: true })
  declare grossAmount: Money | null;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10, allowNull: true })
  declare gpCarryAmount: Money | null;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10, allowNull: true })
  declare lpNetAmount: Money | null;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10, allowNull: true })
  declare refAmount: Money | null;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10, allowNull: true })
  declare navAfter: Money | null;

  @Column({ type: DataType.DECIMAL(10, 6), allowNull: true })
  quantityPct!: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  lpNetAmountOverridden!: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  gpCarryOverridden!: boolean;

  /**
   * Snapshot of the LP principal that this distribution/exit event returned.
   * Load-bearing: every downstream carry computation reads it via
   * `computeCumulativePrincipalReturnedBefore`. Null for non-carry events.
   */
  @Column({ type: DataType.DECIMAL(20, 10), allowNull: true })
  principalReturnedThisEvent!: string | null;

  @ForeignKey(() => Currencies)
  @Index
  @Column({ type: DataType.STRING(CURRENCY_CODE_MAX_LENGTH), allowNull: false })
  currencyCode!: string;

  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    defaultValue: VENTURE_CASH_FLOW_MODE.none,
  })
  cashFlowMode!: VENTURE_CASH_FLOW_MODE;

  @Column({ type: DataType.TEXT, allowNull: true })
  notes!: string | null;

  @Column({ type: DataType.JSONB, allowNull: true, defaultValue: null })
  metaData!: Record<string, unknown> | null;

  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;

  @BelongsTo(() => Users)
  user?: Users;

  @BelongsTo(() => VentureDeals)
  deal?: VentureDeals;

  @BelongsTo(() => Currencies, 'currencyCode')
  currency?: Currencies;

  @HasMany(() => VentureEventLinks)
  links?: VentureEventLinks[];
}

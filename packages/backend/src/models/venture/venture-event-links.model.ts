import { RecordId } from '@bt/shared/types';
import { CURRENCY_CODE_MAX_LENGTH } from '@common/lib/currency-code-columns';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { BelongsTo, Column, DataType, ForeignKey, Index, Model, Table } from 'sequelize-typescript';

import Currencies from '../currencies.model';
import Transactions from '../transactions.model';
import VentureEvents from './venture-events.model';

@Table({
  timestamps: true,
  tableName: 'VentureEventLinks',
})
export default class VentureEventLinks extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => VentureEvents)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  ventureEventId!: RecordId;

  @ForeignKey(() => Transactions)
  @Index
  @Column({ type: DataType.UUID, allowNull: false, unique: true })
  transactionId!: RecordId;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare amount: Money;

  @ForeignKey(() => Currencies)
  @Index
  @Column({ type: DataType.STRING(CURRENCY_CODE_MAX_LENGTH), allowNull: false })
  currencyCode!: string;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  linkedAt!: Date;

  @Column({ type: DataType.JSONB, allowNull: true, defaultValue: null })
  metaData!: Record<string, unknown> | null;

  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;

  @BelongsTo(() => VentureEvents)
  event?: VentureEvents;

  @BelongsTo(() => Transactions)
  transaction?: Transactions;

  @BelongsTo(() => Currencies, 'currencyCode')
  currency?: Currencies;
}

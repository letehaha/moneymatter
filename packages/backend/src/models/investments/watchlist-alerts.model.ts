import {
  RecordId,
  type WatchlistAlertFrequency,
  type WatchlistAlertNotificationPayload,
  type WatchlistAlertType,
} from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType, Index } from 'sequelize-typescript';

import WatchlistItems from './watchlist-items.model';

@Table({ tableName: 'WatchlistAlerts', timestamps: true, freezeTableName: true })
export default class WatchlistAlerts extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => WatchlistItems)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  itemId!: RecordId;

  @Column({ type: DataType.STRING(32), allowNull: false })
  type!: WatchlistAlertType;

  /** Threshold of a price alert, in the security's currency. */
  @MoneyField({ precision: 20, scale: 10, allowNull: true })
  declare price: Money | null;

  /** Threshold of a daily move alert. */
  @Column({ type: DataType.DOUBLE, allowNull: true })
  percent!: number | null;

  @Column({ type: DataType.STRING(32), allowNull: false })
  frequency!: WatchlistAlertFrequency;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  notifyInApp!: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  notifyEmail!: boolean;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  isActive!: boolean;

  /** An `every_time` alert fires only while armed; a close where the condition fails re-arms it. */
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  isArmed!: boolean;

  /** UTC day of the last close evaluated; a close is never evaluated twice. */
  @Column({ type: DataType.DATEONLY, allowNull: true })
  lastEvaluatedPriceDate!: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  lastTriggeredAt!: Date | null;

  /** A fired alert waiting for the next email digest, which sends and clears it. */
  @Column({ type: DataType.JSONB, allowNull: true })
  pendingEmailPayload!: WatchlistAlertNotificationPayload | null;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => WatchlistItems, { foreignKey: 'itemId', onDelete: 'CASCADE' })
  item?: WatchlistItems;
}

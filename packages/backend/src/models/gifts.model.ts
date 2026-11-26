import { type BillingTier, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

import Users from './users.model';

/** A prepaid gift subscription, bought on the landing page and redeemed once by code. */
@Table({ tableName: 'Gifts', timestamps: true, freezeTableName: true })
export default class Gifts extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  /** Stored normalized: uppercase, no separators. */
  @Column({ type: DataType.STRING(32), allowNull: false, unique: true })
  code!: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  tier!: BillingTier;

  @Column({ type: DataType.STRING(100), allowNull: false })
  buyerName!: string;

  @Column({ type: DataType.STRING(320), allowNull: false })
  buyerEmail!: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  recipientName!: string;

  @Column({ type: DataType.STRING(320), allowNull: false })
  recipientEmail!: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  message!: string | null;

  @Column({ type: DataType.DATE, allowNull: false })
  deliverAt!: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  sentAt!: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  redeemedAt!: Date | null;

  @ForeignKey(() => Users)
  @Column({ type: DataType.INTEGER, allowNull: true })
  redeemedByUserId!: number | null;

  @Column({ type: DataType.DATE, allowNull: true })
  refundedAt!: Date | null;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  stripeCheckoutSessionId!: string;

  @Column({ type: DataType.STRING, allowNull: true })
  stripePaymentIntentId!: string | null;

  declare createdAt: Date;
  declare updatedAt: Date;
}

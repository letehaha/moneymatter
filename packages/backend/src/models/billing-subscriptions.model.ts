import {
  BILLING_PROVIDERS,
  type BillingCycle,
  type BillingProvider,
  type BillingTier,
  type RecordId,
  type ScheduledChange,
  type SubscriptionStatus,
} from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

import Users from './users.model';

@Table({
  tableName: 'BillingSubscriptions',
  timestamps: true,
  freezeTableName: true,
})
export default class BillingSubscriptions extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @Column({ type: DataType.STRING(10), allowNull: false, defaultValue: BILLING_PROVIDERS.stripe })
  provider!: BillingProvider;

  /** Apple: `originalTransactionId`, stable across renewals and plan changes. */
  @Column({ type: DataType.STRING, allowNull: false })
  externalSubscriptionId!: string;

  /** Provider customer id; maps unsigned webhooks back to a user. Apple: the owner's `appStoreAccountToken`. */
  @Column({ type: DataType.STRING, allowNull: false })
  externalCustomerId!: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  status!: SubscriptionStatus;

  @Column({ type: DataType.STRING(20), allowNull: false })
  tier!: BillingTier;

  @Column({ type: DataType.STRING(10), allowNull: false })
  billingCycle!: BillingCycle;

  @Column({ type: DataType.DATE, allowNull: false })
  currentPeriodEndsAt!: Date;

  @Column({ type: DataType.JSONB, allowNull: true })
  scheduledChange!: ScheduledChange | null;

  /** Stripe `event.created` or Apple `signedDate`; older payloads than this are dropped. */
  @Column({ type: DataType.DATE, allowNull: false })
  providerUpdatedAt!: Date;
}

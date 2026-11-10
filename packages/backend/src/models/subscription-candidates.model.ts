import { SUBSCRIPTION_CANDIDATE_STATUS, SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_INTERVAL_UNITS, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType } from 'sequelize-typescript';

import Accounts from './accounts.model';
import Subscriptions from './subscriptions.model';
import Users from './users.model';

@Table({
  tableName: 'SubscriptionCandidates',
  timestamps: false,
  freezeTableName: true,
})
export default class SubscriptionCandidates extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @Column({
    type: DataType.STRING(200),
    allowNull: false,
  })
  suggestedName!: string;

  // VARCHAR + TS-side enum (project convention: no DB enums), guarded by a CHECK.
  @Column({
    type: DataType.STRING(50),
    allowNull: false,
  })
  detectedFrequency!: SUBSCRIPTION_FREQUENCIES;

  // The detected step when `detectedFrequency` is `custom`; both null for the presets.
  @Column({
    type: DataType.STRING(10),
    allowNull: true,
  })
  detectedIntervalUnit!: SUBSCRIPTION_INTERVAL_UNITS | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  detectedIntervalCount!: number | null;

  @Column({
    type: DataType.BIGINT,
    allowNull: false,
    comment: 'Average amount in cents',
  })
  averageAmount!: number;

  @Column({
    type: DataType.STRING(3),
    allowNull: false,
  })
  currencyCode!: string;

  @ForeignKey(() => Accounts)
  @Column({
    type: DataType.UUID,
    allowNull: true,
  })
  accountId!: RecordId | null;

  @Column({
    type: DataType.ARRAY(DataType.UUID),
    allowNull: false,
    defaultValue: [],
  })
  sampleTransactionIds!: RecordId[];

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  occurrenceCount!: number;

  @Column({
    type: DataType.FLOAT,
    allowNull: false,
  })
  confidenceScore!: number;

  @Column({
    type: DataType.FLOAT,
    allowNull: false,
  })
  medianIntervalDays!: number;

  @Column({
    type: DataType.ENUM(...Object.values(SUBSCRIPTION_CANDIDATE_STATUS)),
    allowNull: false,
    defaultValue: SUBSCRIPTION_CANDIDATE_STATUS.pending,
  })
  status!: SUBSCRIPTION_CANDIDATE_STATUS;

  @ForeignKey(() => Subscriptions)
  @Column({
    type: DataType.UUID,
    allowNull: true,
  })
  subscriptionId!: RecordId | null;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  detectedAt!: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  lastOccurrenceAt!: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  resolvedAt!: Date | null;

  @BelongsTo(() => Users)
  user!: Users;

  @BelongsTo(() => Accounts)
  account!: Accounts;

  @BelongsTo(() => Subscriptions)
  subscription!: Subscriptions;
}

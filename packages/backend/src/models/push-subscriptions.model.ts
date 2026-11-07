import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType } from 'sequelize-typescript';

import Users from './users.model';

/**
 * One Web Push subscription per browser profile. `endpoint` is the push service's capability URL,
 * so it is unique across all users: holding it proves possession of that browser, and a browser
 * handed to another account moves its row instead of keeping two.
 */
@Table({
  tableName: 'PushSubscriptions',
  timestamps: true,
  freezeTableName: true,
})
export default class PushSubscriptions extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
    unique: true,
  })
  endpoint!: string;

  // base64url, as `PushSubscription.toJSON()` returns them.
  @Column({
    type: DataType.STRING(128),
    allowNull: false,
  })
  p256dh!: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
  })
  auth!: string;

  // First 16 hex characters of SHA-256 over the VAPID public key the subscription was made with.
  @Column({
    type: DataType.STRING(16),
    allowNull: false,
  })
  vapidKeyId!: string;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  expirationTime!: Date | null;

  @Column({
    type: DataType.STRING(512),
    allowNull: true,
  })
  userAgent!: string | null;

  @Column({
    type: DataType.STRING(100),
    allowNull: true,
  })
  deviceLabel!: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  lastSeenAt!: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  lastSuccessAt!: Date | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  lastFailureAt!: Date | null;

  // Consecutive `rejected` sends (the subscription itself was refused); any success resets it.
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
  })
  failureCount!: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  lastFailureStatus!: number | null;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => Users, { foreignKey: 'userId', onDelete: 'CASCADE' })
  user!: Users;
}

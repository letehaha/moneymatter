import { type DeviceTokenEnvironment, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType, Index } from 'sequelize-typescript';

import Users from './users.model';

/** APNs device tokens of the iOS app; a token belongs to whoever registered it last. */
@Table({ tableName: 'DeviceTokens', timestamps: true, freezeTableName: true })
export default class DeviceTokens extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Index
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @Column({ type: DataType.STRING(200), allowNull: false, unique: true })
  token!: string;

  @Column({ type: DataType.STRING(16), allowNull: false })
  environment!: DeviceTokenEnvironment;

  @Column({ type: DataType.STRING(200), allowNull: false })
  bundleId!: string;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => Users, { foreignKey: 'userId', onDelete: 'CASCADE' })
  user?: Users;
}

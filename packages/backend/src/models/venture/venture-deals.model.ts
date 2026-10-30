import { RecordId } from '@bt/shared/types';
import { VENTURE_DEAL_STATUS, VENTURE_SPV_SUBTYPE, VENTURE_VEHICLE_TYPE } from '@bt/shared/types/venture';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { BelongsTo, Column, DataType, ForeignKey, HasMany, Index, Model, Table } from 'sequelize-typescript';

import Currencies from '../currencies.model';
import Users from '../users.model';
import VentureEvents from './venture-events.model';
import VenturePlatforms from './venture-platforms.model';

@Table({
  timestamps: true,
  paranoid: true,
  tableName: 'VentureDeals',
})
export default class VentureDeals extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Index
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId!: number;

  @ForeignKey(() => VenturePlatforms)
  @Index
  @Column({ type: DataType.UUID, allowNull: true })
  platformId!: RecordId | null;

  @Column({ type: DataType.STRING(255), allowNull: false })
  name!: string;

  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    defaultValue: VENTURE_VEHICLE_TYPE.spv,
  })
  vehicleType!: VENTURE_VEHICLE_TYPE;

  @Column({ type: DataType.STRING(32), allowNull: true })
  spvSubtype!: VENTURE_SPV_SUBTYPE | null;

  @Column({ type: DataType.STRING(253), allowNull: true })
  logoDomain!: string | null;

  @Column({ type: DataType.STRING(16), allowNull: true })
  logoInitials!: string | null;

  @Column({ type: DataType.STRING(7), allowNull: true })
  logoColor!: string | null;

  @Column({ type: DataType.STRING(64), allowNull: true })
  logoIcon!: string | null;

  @Column({ type: DataType.UUID, allowNull: true })
  logoImageId!: string | null;

  @Column({ type: DataType.STRING(255), allowNull: true })
  targetCompany!: string | null;

  @ForeignKey(() => Currencies)
  @Index
  @Column({ type: DataType.STRING(3), allowNull: false })
  currencyCode!: string;

  @Index
  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    defaultValue: VENTURE_DEAL_STATUS.outstanding,
  })
  status!: VENTURE_DEAL_STATUS;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare principal: Money;

  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 })
  declare entryFee: Money;

  @Column({ type: DataType.DECIMAL(10, 6), allowNull: false, defaultValue: '0' })
  entryFeePct!: string;

  @Column({ type: DataType.DECIMAL(10, 6), allowNull: false, defaultValue: '0' })
  mgmtFeePct!: string;

  @Column({ type: DataType.DECIMAL(10, 6), allowNull: false, defaultValue: '0' })
  carryPct!: string;

  @Column({ type: DataType.DECIMAL(10, 6), allowNull: false, defaultValue: '0' })
  hurdlePct!: string;

  @Index
  @Column({ type: DataType.DATEONLY, allowNull: false })
  investmentDate!: string;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  expectedExitDate!: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  notes!: string | null;

  @Column({ type: DataType.JSONB, allowNull: true, defaultValue: null })
  metaData!: Record<string, unknown> | null;

  @Column({ type: DataType.DATE, allowNull: false })
  declare createdAt: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  declare updatedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare deletedAt: Date | null;

  @BelongsTo(() => Users)
  user?: Users;

  @BelongsTo(() => VenturePlatforms)
  platform?: VenturePlatforms;

  @BelongsTo(() => Currencies, 'currencyCode')
  currency?: Currencies;

  @HasMany(() => VentureEvents)
  events?: VentureEvents[];
}

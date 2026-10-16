import {
  TRACKER_STATUSES,
  TRACKER_TYPES,
  RecordId,
  TRACKER_AI_DEFAULT_PRE_WINDOW_DAYS,
  type TrackerAiPreWindowDays,
} from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import Categories from '@models/categories.model';
import Transactions from '@models/transactions.model';
import Users from '@models/users.model';
import { Table, Column, Model, ForeignKey, DataType, BelongsToMany, HasMany } from 'sequelize-typescript';

import TrackerCategories from './tracker-categories.model';
import TrackerLines from './tracker-lines.model';
import TrackerTransactions from './tracker-transactions.model';

/** Watches spending over a date range, by linked categories or hand-picked transactions. */
@Table({
  timestamps: false,
})
export default class Trackers extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @Column({ allowNull: false, type: DataType.STRING(200) })
  name!: string;

  @Column({ allowNull: false, type: DataType.ENUM({ values: Object.values(TRACKER_STATUSES) }) })
  status!: TRACKER_STATUSES;

  @Column({
    allowNull: false,
    defaultValue: TRACKER_TYPES.manual,
    type: DataType.ENUM(...Object.values(TRACKER_TYPES)),
  })
  type!: TRACKER_TYPES;

  @Column({ type: DataType.DATE, allowNull: true })
  startDate!: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  endDate!: Date | null;

  @Column({ defaultValue: false, type: DataType.BOOLEAN })
  autoInclude!: boolean;

  @Column({ allowNull: false, defaultValue: false, type: DataType.BOOLEAN })
  archivePromptDismissed!: boolean;

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

  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, roundOnWrite: 2, allowNull: true })
  declare limitAmount: Money | null;

  @Column({ allowNull: false, defaultValue: false, type: DataType.BOOLEAN })
  aiEnabled!: boolean;

  @Column({ type: DataType.TEXT, allowNull: true })
  aiDescription!: string | null;

  @Column({ allowNull: false, defaultValue: TRACKER_AI_DEFAULT_PRE_WINDOW_DAYS, type: DataType.INTEGER })
  aiPreWindowDays!: TrackerAiPreWindowDays;

  /** Transactions updated after this were not seen by the last smart tracking scan; null rescans everything. */
  @Column({ type: DataType.DATE, allowNull: true })
  aiScannedUntil!: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  aiLastScannedAt!: Date | null;

  @ForeignKey(() => Users)
  @Column({ allowNull: false, type: DataType.INTEGER })
  userId!: number;

  @BelongsToMany(() => Transactions, {
    through: { model: () => TrackerTransactions, unique: false },
    foreignKey: 'trackerId',
    otherKey: 'transactionId',
  })
  transactions!: number[];

  @BelongsToMany(() => Categories, {
    through: { model: () => TrackerCategories, unique: false },
    foreignKey: 'trackerId',
    otherKey: 'categoryId',
  })
  categories!: Categories[];

  @HasMany(() => TrackerLines, { foreignKey: 'trackerId', onDelete: 'CASCADE' })
  lines?: TrackerLines[];
}

import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, BelongsTo, BelongsToMany, DataType, Index } from 'sequelize-typescript';

import Categories from './categories.model';
import TrackerLineCategories from './tracker-line-categories.model';
import Trackers from './trackers.model';

/** A per-category limit inside a tracker. */
@Table({
  tableName: 'TrackerLines',
  timestamps: true,
  freezeTableName: true,
})
export default class TrackerLines extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Trackers)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  trackerId!: RecordId;

  @Column({ type: DataType.STRING(200), allowNull: false })
  name!: string;

  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, allowNull: true })
  declare limitAmount: Money | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  position!: number;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => Trackers, { foreignKey: 'trackerId', onDelete: 'CASCADE' })
  tracker?: Trackers;

  @BelongsToMany(() => Categories, {
    through: { model: () => TrackerLineCategories, unique: false },
    foreignKey: 'lineId',
    otherKey: 'categoryId',
  })
  categories!: Categories[];
}

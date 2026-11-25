import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType } from 'sequelize-typescript';

import Portfolios from './portfolios.model';
import Securities from './securities.model';
import WatchlistSections from './watchlist-sections.model';

@Table({
  tableName: 'WatchlistItems',
  timestamps: true,
  freezeTableName: true,
  indexes: [
    { unique: true, fields: ['portfolioId', 'securityId'], name: 'WatchlistItems_portfolioId_securityId_unique' },
    { fields: ['securityId'] },
    { fields: ['sectionId'] },
  ],
})
export default class WatchlistItems extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Portfolios)
  @Column({ type: DataType.UUID, allowNull: false })
  portfolioId!: RecordId;

  @ForeignKey(() => Securities)
  @Column({ type: DataType.UUID, allowNull: false })
  securityId!: RecordId;

  /** Null: shown among the ungrouped items. */
  @ForeignKey(() => WatchlistSections)
  @Column({ type: DataType.UUID, allowNull: true })
  sectionId!: RecordId | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  note!: string | null;

  /** "Buy below" price in the security's currency. */
  @MoneyField({ precision: 20, scale: 10, allowNull: true })
  declare targetPrice: Money | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  sortOrder!: number;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => Portfolios, { foreignKey: 'portfolioId', onDelete: 'CASCADE' })
  portfolio?: Portfolios;

  @BelongsTo(() => Securities, { foreignKey: 'securityId', onDelete: 'CASCADE' })
  security?: Securities;

  @BelongsTo(() => WatchlistSections, { foreignKey: 'sectionId', onDelete: 'SET NULL' })
  section?: WatchlistSections;
}

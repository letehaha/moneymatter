import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType, Index } from 'sequelize-typescript';

import Portfolios from './portfolios.model';

@Table({ tableName: 'WatchlistSections', timestamps: true, freezeTableName: true })
export default class WatchlistSections extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Portfolios)
  @Index
  @Column({ type: DataType.UUID, allowNull: false })
  portfolioId!: RecordId;

  @Column({ type: DataType.STRING(100), allowNull: false })
  name!: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  sortOrder!: number;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => Portfolios, { foreignKey: 'portfolioId', onDelete: 'CASCADE' })
  portfolio?: Portfolios;
}

import { RecordId } from '@bt/shared/types';
import { Table, Column, Model, ForeignKey, DataType } from 'sequelize-typescript';

import Categories from './categories.model';
import TrackerLines from './tracker-lines.model';

@Table({ tableName: 'TrackerLineCategories', timestamps: false })
export default class TrackerLineCategories extends Model {
  @ForeignKey(() => TrackerLines)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  lineId!: RecordId;

  @ForeignKey(() => Categories)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  categoryId!: RecordId;
}

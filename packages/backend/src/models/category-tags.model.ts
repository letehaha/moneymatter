import { RecordId } from '@bt/shared/types';
import Tags from '@models/tags.model';
import { Table, Column, Model, ForeignKey, DataType } from 'sequelize-typescript';

import Categories from './categories.model';

@Table({ tableName: 'CategoryTags', timestamps: false, freezeTableName: true })
export default class CategoryTags extends Model {
  @ForeignKey(() => Categories)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  categoryId!: RecordId;

  @ForeignKey(() => Tags)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  tagId!: RecordId;
}

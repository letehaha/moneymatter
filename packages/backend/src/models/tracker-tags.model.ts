import { RecordId } from '@bt/shared/types';
import { Table, Column, Model, ForeignKey, DataType } from 'sequelize-typescript';

import Tags from './tags.model';
import Trackers from './trackers.model';

/** Rule tags: the owner's transactions carrying any of them are linked to the tracker. */
@Table({ tableName: 'TrackerTags', timestamps: false })
export default class TrackerTags extends Model {
  @ForeignKey(() => Trackers)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  trackerId!: RecordId;

  @ForeignKey(() => Tags)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  tagId!: RecordId;
}

import type { ImportSource, RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

import Users from './users.model';

@Table({
  tableName: 'ImportBatches',
  timestamps: false,
  freezeTableName: true,
  indexes: [{ unique: true, fields: ['userId', 'batchId'] }],
})
export default class ImportBatches extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare userId: number;

  /** The `externalData.importDetails.batchId` stamped on the batch's transactions. Unique per user only. */
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare batchId: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare source: ImportSource;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare importedAt: Date;

  /** Null while the import is running, and forever if its worker crashed. */
  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare finishedAt: Date | null;
}

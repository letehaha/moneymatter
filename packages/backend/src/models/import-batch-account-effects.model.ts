import type { RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

import Accounts from './accounts.model';
import ImportBatches from './import-batches.model';

@Table({
  tableName: 'ImportBatchAccountEffects',
  timestamps: false,
  freezeTableName: true,
  indexes: [{ fields: ['accountId'] }],
})
export default class ImportBatchAccountEffects extends Model {
  @ForeignKey(() => ImportBatches)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  declare importBatchId: RecordId;

  @ForeignKey(() => Accounts)
  @Column({ primaryKey: true, allowNull: false, type: DataType.UUID })
  declare accountId: RecordId;

  /** Signed, in the account's own currency: how far the import shifted the account's opening balance. */
  @MoneyField({ storage: 'cents' })
  declare absorbedAmount: Money;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare createdByImport: boolean;

  // Never drop these associations: they put `references` on the two FK columns,
  // which is what backup restore reads to validate and remap them.
  @BelongsTo(() => ImportBatches)
  declare importBatch: ImportBatches;

  @BelongsTo(() => Accounts)
  declare account: Accounts;
}

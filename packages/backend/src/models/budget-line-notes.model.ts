import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType } from 'sequelize-typescript';

import BudgetLines from './budget-lines.model';
import BudgetPeriods from './budget-periods.model';

/** One row per (period, line) that has a note; clearing the note deletes the row. */
@Table({
  tableName: 'BudgetLineNotes',
  timestamps: true,
  freezeTableName: true,
  indexes: [
    { unique: true, fields: ['periodId', 'lineId'], name: 'BudgetLineNotes_periodId_lineId_unique' },
    { fields: ['lineId'] },
  ],
})
export default class BudgetLineNotes extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => BudgetPeriods)
  @Column({ type: DataType.UUID, allowNull: false })
  periodId!: RecordId;

  @ForeignKey(() => BudgetLines)
  @Column({ type: DataType.UUID, allowNull: false })
  lineId!: RecordId;

  @Column({ type: DataType.TEXT, allowNull: false })
  note!: string;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsTo(() => BudgetPeriods, { foreignKey: 'periodId', onDelete: 'CASCADE' })
  period?: BudgetPeriods;

  @BelongsTo(() => BudgetLines, { foreignKey: 'lineId', onDelete: 'CASCADE' })
  line?: BudgetLines;
}

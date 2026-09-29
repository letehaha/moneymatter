import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import Transactions from '@models/transactions.model';
import Users from '@models/users.model';
import { Op, literal } from 'sequelize';
import { Table, Column, Model, ForeignKey, DataType, BelongsToMany } from 'sequelize-typescript';

import TransactionGroupItems from './transaction-group-items.model';

@Table({
  tableName: 'TransactionGroups',
  timestamps: true,
})
export default class TransactionGroups extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Column({ allowNull: false, type: DataType.INTEGER })
  userId!: number;

  @Column({ allowNull: false, type: DataType.STRING(100) })
  name!: string;

  @Column({ allowNull: true, type: DataType.STRING(500) })
  note!: string | null;

  declare createdAt: Date;
  declare updatedAt: Date;

  @BelongsToMany(() => Transactions, {
    through: { model: () => TransactionGroupItems, unique: false },
    foreignKey: 'groupId',
    otherKey: 'transactionId',
  })
  transactions!: Transactions[];
}

export const dissolveUndersizedGroups = async ({ groupIds }: { groupIds: string[] }) => {
  if (groupIds.length === 0) return;

  const underMinGroups = (await TransactionGroups.findAll({
    where: {
      id: { [Op.in]: groupIds },
      [Op.and]: literal(`(
        SELECT COUNT(*)
        FROM "TransactionGroupItems"
        WHERE "TransactionGroupItems"."groupId" = "TransactionGroups"."id"
      ) < 2`),
    },
    attributes: ['id'],
    raw: true,
  })) as TransactionGroups[];

  const idsToDelete = underMinGroups.map((g) => g.id);
  if (idsToDelete.length > 0) {
    await TransactionGroups.destroy({ where: { id: { [Op.in]: idsToDelete } } });
  }
};

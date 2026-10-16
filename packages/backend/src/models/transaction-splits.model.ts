import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType, Length } from 'sequelize-typescript';

import Categories from './categories.model';
import Transactions from './transactions.model';
import Users from './users.model';

@Table({
  tableName: 'TransactionSplits',
  timestamps: false,
  freezeTableName: true,
  indexes: [
    {
      fields: ['transactionId'],
    },
    {
      fields: ['userId'],
    },
    {
      fields: ['categoryId'],
    },
    {
      fields: ['transactionId', 'categoryId'],
      unique: true,
    },
  ],
})
export default class TransactionSplits extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Transactions)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  transactionId!: RecordId;

  @ForeignKey(() => Users)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @ForeignKey(() => Categories)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  categoryId!: RecordId;

  /** Amount in account currency (same as transaction.amount) */
  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, roundOnWrite: 2 })
  declare amount: Money;

  /** Amount in base currency (same as transaction.refAmount) */
  @MoneyField({ storage: 'decimal', precision: 36, scale: 18, roundOnWrite: 2 })
  declare refAmount: Money;

  // Optional per-split note, max 100 chars
  @Length({ max: 100 })
  @Column({
    type: DataType.STRING(100),
    allowNull: true,
  })
  note!: string | null;

  @BelongsTo(() => Transactions)
  transaction!: Transactions;

  @BelongsTo(() => Users)
  user!: Users;

  @BelongsTo(() => Categories)
  category!: Categories;
}

// Helper functions for working with splits

export interface CreateSplitPayload {
  transactionId: string;
  userId: number;
  categoryId: string;
  amount: Money;
  refAmount: Money;
  note?: string | null;
}

export const bulkCreateSplits = async ({ data }: { data: CreateSplitPayload[] }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return TransactionSplits.bulkCreate(data as any, { individualHooks: true });
};

export const deleteSplitsForTransaction = async ({
  transactionId,
  userId,
}: {
  transactionId: string;
  /**
   * Optional. When omitted (callers that have already authorized via the parent
   * transaction's account), all splits for the transaction are deleted regardless
   * of which user authored each row. Required for legacy single-user callsites that
   * still scope by creator.
   */
  userId?: number;
}) => {
  const where: { transactionId: string; userId?: number } = { transactionId };
  if (userId !== undefined) where.userId = userId;
  return TransactionSplits.destroy({ where });
};

export const deleteSplitById = async ({ id, userId }: { id: string; userId: number }) => {
  return TransactionSplits.destroy({
    where: { id, userId },
  });
};

export const getSplitById = async ({ id, userId }: { id: string; userId: number }) => {
  return TransactionSplits.findOne({
    where: { id, userId },
    include: [{ model: Categories, as: 'category' }],
  });
};

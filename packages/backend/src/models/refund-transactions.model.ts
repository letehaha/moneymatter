import { RecordId } from '@bt/shared/types';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { Table, Column, Model, ForeignKey, BelongsTo, DataType } from 'sequelize-typescript';

import TransactionSplits from './transaction-splits.model';
import Transactions from './transactions.model';
import Users from './users.model';

@Table({
  tableName: 'RefundTransactions',
  timestamps: true,
  freezeTableName: true,
  indexes: [
    {
      fields: ['userId'],
    },
    {
      fields: ['originalTxId'],
    },
    {
      name: 'refund_transactions_refund_tx_original_tx_unique_idx',
      fields: ['refundTxId', 'originalTxId'],
      unique: true,
    },
    {
      name: 'refund_transactions_refund_tx_no_original_unique_idx',
      fields: ['refundTxId'],
      unique: true,
      where: { originalTxId: null },
    },
  ],
})
export default class RefundTransactions extends Model {
  @Column(IdColumn())
  declare id: RecordId;

  @ForeignKey(() => Users)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId!: number;

  @ForeignKey(() => Transactions)
  @Column({
    // Can be nullish to support cases like when user has account_A in the system, he receives tx_A,
    // but in fact it's a refund for some tx_B in an "out of system" account. It is important to
    // consider that not all user real-life accounts will be present in the system
    allowNull: true,
    type: DataType.UUID,
  })
  originalTxId!: RecordId | null;

  @ForeignKey(() => Transactions)
  @Column({
    allowNull: false,
    type: DataType.UUID,
  })
  refundTxId!: RecordId;

  // Share of the refund transaction, in its currency. NULL means the whole refund transaction.
  @MoneyField({ storage: 'cents', allowNull: true })
  declare amount: Money | null;

  // Optional: when set, the refund applies to a specific split rather than the whole transaction
  @ForeignKey(() => TransactionSplits)
  @Column({
    allowNull: true,
    type: DataType.UUID,
  })
  splitId!: RecordId | null;

  @BelongsTo(() => TransactionSplits)
  split!: TransactionSplits;

  @BelongsTo(() => Users)
  user!: Users;

  @BelongsTo(() => Transactions, 'originalTxId')
  originalTransaction!: Transactions;

  @BelongsTo(() => Transactions, 'refundTxId')
  refundTransaction!: Transactions;
}

export const createRefundTransaction = async ({
  userId,
  originalTxId,
  refundTxId,
  splitId,
  amount,
}: {
  userId: number;
  originalTxId: string | null;
  refundTxId: string;
  splitId?: string | null;
  amount?: Money | null;
}) => {
  return RefundTransactions.create({ userId, originalTxId, refundTxId, splitId, amount: amount ?? null });
};

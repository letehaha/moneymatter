import { api } from '@/api/_api';
import { TransactionModel } from '@bt/shared/types';

type RefundRelationship = {
  id: string;
  originalTxId: string | null;
  refundTxId: string;
  /** The split this refund targets. Null if refunding the whole transaction. */
  splitId: string | null;
  /** Share of the refund tx, in its currency. Null when the link covers the whole refund. */
  amount: number | null;
  originalTransaction?: TransactionModel;
  refundTransaction: TransactionModel;
};

type GetRefundsResponse = RefundRelationship[];

export const getRefundsForTransaction = async (params: { transactionId: string }): Promise<GetRefundsResponse> => {
  return api.get(`/transactions/${params.transactionId}/refunds`, params);
};

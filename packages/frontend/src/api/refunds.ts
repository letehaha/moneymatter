import { api } from '@/api/_api';
import { TransactionModel } from '@bt/shared/types';

type RefundRelationship = {
  id: string;
  originalTxId: string;
  refundTxId: string;
  /** The split this refund targets. Null if refunding the whole transaction. */
  splitId: string | null;
  originalTransaction: TransactionModel;
  refundTransaction: TransactionModel;
};

type GetRefundsResponse = RefundRelationship[];

export const getRefundsForTransaction = async (params: { transactionId: string }): Promise<GetRefundsResponse> => {
  return api.get(`/transactions/${params.transactionId}/refunds`, params);
};

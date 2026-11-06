/**
 * Refund Transaction Serializers
 *
 * Handles conversion between internal cents representation and API decimal format
 * for RefundTransactions and their nested transactions.
 * - Serializers: DB (cents) → API (decimal)
 */
import type RefundTransactions from '@models/refund-transactions.model';

import { type TransactionApiResponse, serializeTransaction } from './transactions.serializer';

// ============================================================================
// Response Types (API format with DecimalAmount)
// ============================================================================

interface RefundTransactionApiResponse {
  id: string;
  userId: number;
  originalTxId: string | null;
  refundTxId: string;
  splitId: string | null;
  amount: number | null;
  createdAt?: Date;
  updatedAt?: Date;
  // Nested transactions (when included)
  originalTransaction?: TransactionApiResponse;
  refundTransaction?: TransactionApiResponse;
}

// ============================================================================
// Serializers (DB → API)
// ============================================================================

/**
 * Serialize a refund transaction from DB format to API response
 * Handles nested originalTransaction and refundTransaction if present
 */
export function serializeRefundTransaction(refund: RefundTransactions): RefundTransactionApiResponse {
  const response: RefundTransactionApiResponse = {
    id: refund.id,
    userId: refund.userId,
    originalTxId: refund.originalTxId,
    refundTxId: refund.refundTxId,
    splitId: refund.splitId,
    amount: refund.amount?.toNumber() ?? null,
  };

  // Include timestamps if available
  if ('createdAt' in refund && refund.createdAt) {
    response.createdAt = refund.createdAt as Date;
  }
  if ('updatedAt' in refund && refund.updatedAt) {
    response.updatedAt = refund.updatedAt as Date;
  }

  // Serialize nested transactions if present
  if (refund.originalTransaction) {
    response.originalTransaction = serializeTransaction(refund.originalTransaction);
  }
  if (refund.refundTransaction) {
    response.refundTransaction = serializeTransaction(refund.refundTransaction);
  }

  return response;
}

/**
 * Serialize multiple refund transactions
 */
export function serializeRefundTransactions(refunds: RefundTransactions[]): RefundTransactionApiResponse[] {
  return refunds.map(serializeRefundTransaction);
}

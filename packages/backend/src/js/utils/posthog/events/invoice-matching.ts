import { trackEvent } from '../index';

/** Fired once per uploaded invoice, whether or not anything matched. */
export function trackInvoiceMatchRequested({
  userId,
  transactionType,
  candidatesCount,
  topScore,
  provider,
  modelId,
  usedJev,
}: {
  userId: string | number;
  transactionType: string;
  candidatesCount: number;
  topScore: number;
  provider: string;
  modelId: string;
  usedJev: boolean;
}): void {
  trackEvent({
    userId,
    event: 'invoice_match_requested',
    properties: {
      transaction_type: transactionType,
      candidates_count: candidatesCount,
      top_score: topScore,
      provider,
      model_id: modelId,
      used_jev: usedJev,
    },
  });
}

/** Fired once per successfully read receipt; the flags show how often each suggestion lands. */
export function trackReceiptScanned({
  userId,
  transactionType,
  provider,
  modelId,
  hasAccount,
  hasPayee,
  hasCategory,
}: {
  userId: string | number;
  transactionType: string;
  provider: string;
  modelId: string;
  hasAccount: boolean;
  hasPayee: boolean;
  hasCategory: boolean;
}): void {
  trackEvent({
    userId,
    event: 'receipt_scanned',
    properties: {
      transaction_type: transactionType,
      provider,
      model_id: modelId,
      has_suggested_account: hasAccount,
      has_suggested_payee: hasPayee,
      has_suggested_category: hasCategory,
    },
  });
}

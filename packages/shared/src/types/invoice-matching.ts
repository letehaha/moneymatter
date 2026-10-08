import type { TransactionModel } from './transactions';
import { TRANSACTION_TYPES } from './transactions';

/** Invoice fields the AI reads out of an uploaded document. Amounts are decimals. */
export interface ExtractedInvoice {
  /** Chosen by the user, not read from the document: an invoice never says which party they are. */
  transactionType: TRANSACTION_TYPES;
  vendorName: string;
  /** The billed party. It is who pays an invoice the user issued, so income is matched against it. */
  customerName: string | null;
  totalAmount: number;
  currencyCode: string;
  /** `YYYY-MM-DD` */
  issueDate: string;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
}

/**
 * Who the bank names on the payment: the vendor on a bill the user paid, the customer on one
 * they issued. Null when the document names nobody on that side.
 */
export const invoiceCounterpartyName = ({ invoice }: { invoice: ExtractedInvoice }): string | null =>
  invoice.transactionType === TRANSACTION_TYPES.income ? invoice.customerName : invoice.vendorName;

/**
 * `converted` means the candidate was compared in base currency, not the invoice's.
 * `unknown` means no rate was available, so the amounts were never compared.
 */
export type InvoiceAmountSignal = 'exact' | 'close' | 'converted' | 'unknown';

/**
 * `unknown`: nothing to judge, either because the invoice names no counterparty or because
 * the transaction has no payee and its note does not mention the name.
 */
export type InvoiceMerchantSignal = 'match' | 'partial' | 'none' | 'unknown';

export interface InvoiceMatchSignals {
  amount: InvoiceAmountSignal;
  /** Gap in the invoice currency, only for `close`. */
  amountDiff: number | null;
  /** Transaction date minus invoice issue date, in days. Negative = before the invoice. */
  daysFromInvoice: number;
  merchant: InvoiceMerchantSignal;
}

export interface InvoiceMatchCandidate<T = TransactionModel> {
  transaction: T;
  /** 0-100. */
  score: number;
  signals: InvoiceMatchSignals;
}

export interface InvoiceMatchResult<T = TransactionModel> {
  invoice: ExtractedInvoice;
  candidates: InvoiceMatchCandidate<T>[];
}

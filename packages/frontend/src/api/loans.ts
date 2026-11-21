import { api } from '@/api/_api';
import type { LoanApiResponse, LoanBalanceHistoryPoint } from '@bt/shared/types';
import { LOAN_TYPE } from '@bt/shared/types';

// The loan/balance-history wire shapes live in @bt/shared/types, shared with the
// backend serializer so the two can't drift. `LoanApi` keeps the frontend-local
// name every consumer already imports.
export type { LoanApiResponse as LoanApi, LoanBalanceHistoryPoint };

export const getLoans = async (): Promise<LoanApiResponse[]> => {
  return api.get('/loans');
};

export const getLoanById = async ({ id }: { id: string }): Promise<LoanApiResponse> => {
  return api.get(`/loans/${id}`);
};

/**
 * Outstanding-balance series in the loan's native currency: the anchor snapshot
 * followed by one cumulative end-of-day point per payment day. Unlike the
 * generic `/stats/balance-history` (base-currency figures), these amounts share
 * units with `originalPrincipal` and the loan's own currency formatting.
 */
export const getLoanBalanceHistory = async ({ id }: { id: string }): Promise<LoanBalanceHistoryPoint[]> => {
  return api.get(`/loans/${id}/balance-history`);
};

/** Amounts in and out are decimals; never send cents. */
export interface CreateLoanPayload {
  name: string;
  currencyCode: string;
  initialBalance: number;

  loanType: LOAN_TYPE;
  originalPrincipal: number;
  interestRate: number;
  termMonths?: number | null;
  startDate: string;
  minPayment?: number | null;
  plannedPayment?: number | null;
  paymentDayOfMonth?: number | null;
  lenderName?: string | null;
  accountNumber?: string | null;
}

export const createLoan = async (payload: CreateLoanPayload): Promise<LoanApiResponse> => {
  return api.post('/loans', payload);
};

/**
 * All fields optional (empty body rejected). No `currencyCode`/`loanType` – currency
 * switch unsupported, loanType is UI-only. `currentBalance` is positive; the service
 * flips the sign before writing to Accounts.currentBalance.
 */
export interface UpdateLoanPayload {
  name?: string;
  currentBalance?: number;
  /** 'yyyy-MM-dd' date the balance correction is asserted as-of. Only sent when currentBalance is included. */
  currentBalanceAsOf?: string;
  interestRate?: number;
  termMonths?: number | null;
  startDate?: string;
  minPayment?: number | null;
  plannedPayment?: number | null;
  paymentDayOfMonth?: number | null;
  lenderName?: string | null;
  accountNumber?: string | null;
}

export const updateLoan = async ({ id, ...payload }: UpdateLoanPayload & { id: string }): Promise<LoanApiResponse> => {
  return api.patch(`/loans/${id}`, payload);
};

export const deleteLoan = async ({ id }: { id: string }): Promise<void> => {
  return api.delete(`/loans/${id}`);
};

interface LinkLoanPaymentsResponse {
  loan: LoanApiResponse;
  /** Number of transactions converted into payments. */
  linkedCount: number;
}

/**
 * Converts expense transactions into transfer-to-loan payments. Backend refuses with
 * `loanPaymentOverpayConfirmationRequired` on overpay; retry with `confirmOverpay: true`.
 */
export const linkLoanPayments = async ({
  id,
  transactionIds,
  confirmOverpay,
}: {
  id: string;
  transactionIds: string[];
  confirmOverpay?: boolean;
}): Promise<LinkLoanPaymentsResponse> => {
  return api.post(`/loans/${id}/link-payments`, { transactionIds, confirmOverpay });
};

interface UnlinkLoanPaymentResponse {
  loan: LoanApiResponse;
  /** Id of the expense transaction that was restored from the deleted loan-side leg. */
  restoredTransactionId: string;
}

/**
 * Delete the loan-side leg of a linked payment and restore the original
 * expense transaction. The loan balance is recalculated after unlinking.
 */
export const unlinkLoanPayment = async ({
  id,
  transactionId,
}: {
  id: string;
  transactionId: string;
}): Promise<UnlinkLoanPaymentResponse> => {
  return api.post(`/loans/${id}/unlink-payment`, { transactionId });
};

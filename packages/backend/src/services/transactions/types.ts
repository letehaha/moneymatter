import { ACCOUNT_TYPES, PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import type { TransactionLocation } from '@bt/shared/types';
import { Money } from '@common/types/money';
import * as Transactions from '@models/transactions.model';

import type { PaymentLegParam } from './payment-legs';
import { SplitInput } from './splits/types';

export type CreateTransactionParams = Omit<
  Transactions.CreateTransactionPayload,
  'refAmount' | 'transferId' | 'currencyCode' | 'refCurrencyCode' | 'accountType'
> & {
  /**
   * Provider and importer code declares the type it syncs into. Leaving it out marks the row
   * as user-typed: the create path then reads the real type off the account, and rejects a
   * non-planned row on a provider account. No HTTP or MCP schema accepts it.
   */
  accountType?: ACCOUNT_TYPES;
  destinationAmount?: Money;
  destinationAccountId?: string;
  destinationTransactionId?: string;
  refundsTxId?: string;
  refundsSplitId?: string;
  splits?: SplitInput[];
  tagIds?: string[];
  /**
   * Raw merchant string supplied by a bank-data provider (Monobank `counterName`,
   * SimpleFIN `payee`, EnableBanking debtor/creditor name, LunchFlow `merchant`).
   * When set and the row isn't `payeeLocked` and no `payeeId` was explicitly
   * provided, the create path runs Payee extraction and links + auto-categorizes
   * via `payee_rule` if applicable.
   */
  rawMerchantName?: string | null;
  /**
   * true means the provided `categoryId` is an explicit per-row/user-mapped
   * choice (not a fallback default), so it wins over a linked Payee's
   * `enforce`/`hint` categorization; inert when no `categoryId` is provided.
   *
   * Off by default: manual-entry and bank-sync rows let an `enforce` Payee
   * override a passed `categoryId`. Only CSV / Wallet import opts in, where the
   * mapped-column category is the source of truth.
   */
  categoryIdIsExplicit?: boolean;
  /**
   * Let this row confirm a matching planned transaction instead of inserting a new one.
   * Service-only: no HTTP or MCP schema accepts it, so external callers can't trigger merges.
   * Set by incremental bank sync and imports; never by manual creation or historical backfill.
   */
  matchPlanned?: boolean;
  /**
   * Run the user's automations on a system-account row. Off by default so a hand-typed
   * entry is never overridden; API integrations posting bank data opt in per request.
   */
  applyAutomations?: boolean;
  /** The other accounts of a multi-account payment; the main row keeps `accountId` and `amount`. */
  paymentLegs?: PaymentLegParam[];
};

interface UpdateParams {
  id: string;
  userId: number;
  amount?: Money;
  note?: string | null;
  externalUrl?: string | null;
  externalReference?: string | null;
  location?: TransactionLocation | null;
  time?: Date;
  transactionType?: TRANSACTION_TYPES;
  paymentType?: PAYMENT_TYPES;
  accountId?: string;
  categoryId?: string;
  transferNature?: TRANSACTION_TRANSFER_NATURE;
  refundsTxId?: string | null;
  refundsSplitId?: string | null;
  refundedByTxIds?: string[] | null;
  splits?: SplitInput[] | null; // null to clear all splits
  tagIds?: string[] | null; // null to clear all tags
  payeeId?: string | null;
  payeeLocked?: boolean;
  isPlanned?: boolean;
  /** `null` clears the stored metadata; both fields move together. */
  originalAmount?: Money | null;
  originalCurrencyCode?: string | null;
  /** Full replacement of the payment's other accounts; `null` drops them, absent keeps them. */
  paymentLegs?: PaymentLegParam[] | null;
}

interface UpdateTransferParams {
  destinationAmount?: Money;
  destinationTransactionId?: string;
  destinationAccountId?: string;
  transferNature?: TRANSACTION_TRANSFER_NATURE;
  transferId?: string;
  /**
   * Skip the per-leg loan overpay guard in `createOppositeTransaction`. Set
   * only by `linkLoanPayments`, which row-locks the loan and runs one aggregate
   * overpay check for the batch. No Zod schema accepts it, so an HTTP client
   * cannot set it.
   */
  skipLoanOverpayAssert?: boolean;
}

export type UpdateTransactionParams = UpdateParams & UpdateTransferParams;

import type { VerbosePaymentType } from '@/common/const';
import type { FormattedCategory } from '@/common/types';
import { AccountModel, CurrencyModel, PortfolioModel, TransactionModel } from '@bt/shared/types';

export enum FORM_TYPES {
  income = 'income',
  expense = 'expense',
  transfer = 'transfer',
}

/**
 * Represents a refund relationship with optional split targeting.
 * When a transaction has splits, refunds should target specific splits.
 */
export interface RefundWithSplit {
  transaction: TransactionModel;
  /** The split ID this refund targets. Required when the original transaction has splits. */
  splitId?: string;
}

export type RefundsAnoterTx = RefundWithSplit | null | undefined;
export type RefundedByAnotherTxs = RefundWithSplit[] | null | undefined;

/**
 * UI representation of a transaction split for form editing.
 * Uses FormattedCategory for UI display and optional id for existing splits.
 */
export interface FormSplit {
  /** UUID for existing splits, undefined for new ones */
  id?: string;
  category: FormattedCategory | null;
  amount: number | null;
  note?: string | null;
}

export interface UI_FORM_STRUCT {
  amount: number | null;
  account: AccountModel | null;
  toAccount?: AccountModel | null;
  toPortfolio?: PortfolioModel | null;
  /** The portfolio's recorded cash already includes this money, so linking must not add it again. */
  portfolioCashAlreadyReflected?: boolean;
  category: FormattedCategory | null;
  time: Date;
  paymentType: VerbosePaymentType | null;
  note?: string;
  externalUrl?: string;
  externalReference?: string;
  /** `undefined` = untouched, `null` = cleared by the user. */
  latitude?: number | null;
  longitude?: number | null;
  type: FORM_TYPES;
  targetAmount?: number | null;
  refundedByTxs: RefundedByAnotherTxs;
  refundsTx: RefundsAnoterTx;
  /** Optional splits for distributing transaction amount across multiple categories */
  splits?: FormSplit[];
  /** Optional tag IDs to associate with the transaction */
  tagIds?: string[];
  /** Linked Payee id; null = no Payee set. Manual UI assignment also locks the row server-side. */
  payeeId?: string | null;
  /** True when the form initialized from an existing tx whose category was already user-touched. Used to gate the Payee auto-fill so we don't clobber an explicit category. */
  categoryUserTouched?: boolean;
  /** Entry for money that hasn't moved yet: no balance impact until it's confirmed. */
  isPlanned?: boolean;
  /** Decimal amount actually spent, in `originalCurrency`. Reaches the API only as a complete pair. */
  originalAmount?: number | null;
  /** Any ISO currency, not only the user's linked ones. Sent to the API as its `code`. */
  originalCurrency?: CurrencyModel | null;
}

/** Creation-mode starting values. */
export type TransactionPrefill = Pick<UI_FORM_STRUCT, 'type' | 'account' | 'amount' | 'time'> &
  Partial<
    Pick<
      UI_FORM_STRUCT,
      | 'category'
      | 'payeeId'
      | 'tagIds'
      | 'paymentType'
      | 'latitude'
      | 'longitude'
      | 'isPlanned'
      | 'splits'
      | 'toAccount'
      | 'targetAmount'
      | 'note'
      | 'externalReference'
      | 'externalUrl'
      | 'originalAmount'
      | 'originalCurrency'
    >
  >;

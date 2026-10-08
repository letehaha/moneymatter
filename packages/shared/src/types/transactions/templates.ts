import { RecordId } from '../record-id';
import type { PAYMENT_TYPES, TRANSACTION_TYPES } from './transactions';

export interface TransactionTemplateModel {
  id: RecordId;
  userId: number;
  name: string;
  transactionType: TRANSACTION_TYPES;
  /** Pinned amount as a decimal (e.g. 9.99); null means the user types it each time. Persisted as cents. */
  amount: number | null;
  /**
   * Null keeps whatever account the form already has selected.
   * A non-null `amount` requires this: the account supplies the currency.
   */
  accountId: RecordId | null;
  categoryId: RecordId | null;
  payeeId: RecordId | null;
  paymentType: PAYMENT_TYPES | null;
  note: string | null;
  /** ISO 4217 code preselected in the form's "original amount" field; the amount itself is typed each time. */
  originalCurrencyCode: string | null;
  tagIds: RecordId[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTransactionTemplateBody {
  name: TransactionTemplateModel['name'];
  transactionType: TransactionTemplateModel['transactionType'];
  amount?: TransactionTemplateModel['amount'];
  accountId?: TransactionTemplateModel['accountId'];
  categoryId?: TransactionTemplateModel['categoryId'];
  payeeId?: TransactionTemplateModel['payeeId'];
  paymentType?: TransactionTemplateModel['paymentType'];
  note?: TransactionTemplateModel['note'];
  originalCurrencyCode?: TransactionTemplateModel['originalCurrencyCode'];
  /** Full replacement of the template's tag set. */
  tagIds?: TransactionTemplateModel['tagIds'];
}

/** `undefined` leaves a field unchanged, `null` clears it. */
export type UpdateTransactionTemplateBody = Partial<CreateTransactionTemplateBody>;

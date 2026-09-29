import { TRANSACTION_TYPES } from '@bt/shared/types';
import { startOfDay } from 'date-fns';
import { Op, Sequelize } from 'sequelize';

import { type EnableBankingTransaction, TransactionStatus } from '../types';
import type { EditMergeSide } from './plan-edit-merge';

/**
 * The stored-row fields these helpers read, declared structurally so unit tests
 * can pass plain objects instead of model instances.
 */
interface StoredRow {
  externalData: Record<string, unknown> | null;
}

export interface CounterpartyRow extends StoredRow {
  transactionType: TRANSACTION_TYPES;
}

/** Matches rows that carry no bank-assigned entry reference yet. */
export function whereNoEntryReference() {
  return Sequelize.where(Sequelize.literal(`"externalData"->>'entryReference'`), { [Op.is]: null as unknown as null });
}

/** The note the sync path writes for a raw Enable Banking payload. */
export function deriveNoteFromRaw({ rawTransaction }: { rawTransaction: EnableBankingTransaction }): string {
  return rawTransaction.remittance_information?.join(' ') || 'Transaction';
}

/**
 * Counterparty name for Payee extraction. `'Unknown'` is the literal sentinel
 * fetchTransactions writes when both debtor and creditor names were absent, so
 * it must never reach the merchant fields.
 */
export function cleanMerchantName({ merchantName }: { merchantName: string | undefined }): string {
  return merchantName && merchantName !== 'Unknown' ? merchantName.trim() : '';
}

/** Spreading raw metadata would carry `key: undefined` in and drop the stored value on serialization. */
export function withoutUndefinedValues<T extends Record<string, unknown>>({ source }: { source: T }): T {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined)) as T;
}

/** The raw ASPSP payload sync stored alongside a row, or null for non-synced rows. */
export function getRawTransaction({
  externalData,
}: {
  externalData: Record<string, unknown> | null | undefined;
}): EnableBankingTransaction | null {
  return (externalData?.rawTransaction as EnableBankingTransaction | undefined) ?? null;
}

export function getRawTransactionStatus({
  externalData,
}: {
  externalData: Record<string, unknown> | null | undefined;
}): TransactionStatus | null {
  return getRawTransaction({ externalData })?.status ?? null;
}

/**
 * Kept in step with the SQL predicate `"externalData"->>'entryReference' IS NULL`,
 * which treats any JSON value as present. A corrupt non-string must not read as
 * "has no reference" here while the query says otherwise.
 */
export function getEntryReference({ tx }: { tx: StoredRow }): string | null {
  const entryReference = tx.externalData?.entryReference;
  if (entryReference === null || entryReference === undefined) return null;
  return typeof entryReference === 'string' ? entryReference : String(entryReference);
}

/** Creditor/invoice reference the ASPSP attached to the payment, or null when it carried none. */
export function getReferenceNumber({
  externalData,
}: {
  externalData: Record<string, unknown> | null | undefined;
}): string | null {
  const referenceNumber = externalData?.referenceNumber;
  return typeof referenceNumber === 'string' ? referenceNumber.trim().slice(0, 255) || null : null;
}

export function getBookingDate({
  externalData,
}: {
  externalData: Record<string, unknown> | null | undefined;
}): string | null {
  const bookingDate = externalData?.bookingDate;
  return typeof bookingDate === 'string' && bookingDate.length > 0 ? bookingDate : null;
}

/**
 * A booking date as a day key, or null when the stored value does not parse.
 * Mirrors how `time` itself is built from a date-only string, so a row's booking
 * key and its display key land on the same day whatever the server's timezone.
 */
export function parseBookingDay({ bookingDate }: { bookingDate: string }): Date | null {
  const parsed = new Date(bookingDate);
  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

export function getCounterpartyIban({ tx }: { tx: CounterpartyRow }): string | null {
  const { externalData } = tx;
  if (!externalData) return null;
  const field = tx.transactionType === TRANSACTION_TYPES.expense ? 'creditorAccount' : 'debtorAccount';
  const iban = externalData[field];
  return typeof iban === 'string' && iban.length > 0 ? iban : null;
}

/** Reserved money the ASPSP has not accounted yet. Both statuses turn into BOOK later. */
const PRE_BOOKING_STATUSES = [TransactionStatus.PDNG, TransactionStatus.HOLD];

/** The ASPSP abandoned a payment it had already reported. */
const REVOKED_STATUSES = [TransactionStatus.CNCL, TransactionStatus.RJCT];

export function isPreBookingStatus({ status }: { status: TransactionStatus | null }): boolean {
  return status !== null && PRE_BOOKING_STATUSES.includes(status);
}

export function isRevokedStatus({ status }: { status: TransactionStatus | null }): boolean {
  return status !== null && REVOKED_STATUSES.includes(status);
}

/** Payloads that must never become a ledger row: abandoned, or not executed yet. */
export function isNonLedgerStatus({ status }: { status: TransactionStatus | null }): boolean {
  return isRevokedStatus({ status }) || status === TransactionStatus.SCHD;
}

/** SQL twin of `isPreBookingStatus`, read off the stored raw payload. */
export function wherePreBookingStatus() {
  return Sequelize.where(Sequelize.literal(`"externalData"->'rawTransaction'->>'status'`), {
    [Op.in]: PRE_BOOKING_STATUSES,
  });
}

export function setRawTransactionStatus({ status }: { status: TransactionStatus }) {
  return Sequelize.literal(`jsonb_set("externalData", '{rawTransaction,status}', '"${status}"')`);
}

export function isPreBookingRow({ tx }: { tx: StoredRow }): boolean {
  return isPreBookingStatus({ status: getRawTransactionStatus({ externalData: tx.externalData }) });
}

/**
 * Rows reconcile may keep as the survivor. A cancelled, rejected, scheduled or
 * held row must never be the one a real transaction is merged into and deleted
 * for. Null = no stored payload.
 */
export function hasSettledStatus({ tx }: { tx: StoredRow }): boolean {
  const status = getRawTransactionStatus({ externalData: tx.externalData });
  return status === null || status === TransactionStatus.BOOK || status === TransactionStatus.OTHR;
}

/** A row a pending copy may be folded into. Pre-booking never qualifies, whatever else it carries. */
export function isBookedCanonical({ tx }: { tx: StoredRow }): boolean {
  if (!hasSettledStatus({ tx })) return false;
  return (
    getRawTransactionStatus({ externalData: tx.externalData }) === TransactionStatus.BOOK ||
    getEntryReference({ tx }) !== null
  );
}

/** The note the sync path derives from the stored raw payload, or null for non-synced rows. */
export function syncGeneratedNote({ tx }: { tx: StoredRow }): string | null {
  const rawTransaction = getRawTransaction({ externalData: tx.externalData });
  if (!rawTransaction) return null;
  return deriveNoteFromRaw({ rawTransaction });
}

/** Projects a stored row onto the scalars the reconcile merge policy reads. */
export function toEditMergeSide({ tx }: { tx: EditMergeSide }): EditMergeSide {
  return {
    note: tx.note ?? null,
    categoryId: tx.categoryId,
    paymentType: tx.paymentType,
    payeeId: tx.payeeId,
    payeeLocked: tx.payeeLocked,
    categorizationMeta: tx.categorizationMeta,
  };
}

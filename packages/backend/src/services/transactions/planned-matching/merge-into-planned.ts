import { ACCOUNT_TYPES, type TransactionLocation } from '@bt/shared/types';
import { Money } from '@common/types/money';
import Transactions from '@models/transactions.model';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { resolvePayeeForIncomingRow } from '@services/payees/resolve-payee-for-incoming-row';

export interface IncomingTransactionData {
  time: Date;
  note?: string | null;
  originalId?: string | null;
  externalData?: Record<string, unknown> | null;
  commissionRate?: Money;
  cashbackAmount?: Money;
  originalAmount?: Money | null;
  originalCurrencyCode?: string | null;
  accountType: ACCOUNT_TYPES;
  rawMerchantName?: string | null;
  externalUrl?: string | null;
  externalReference?: string | null;
  location?: TransactionLocation | null;
}

const joinNotes = ({
  plannedNote,
  bankNote,
}: {
  plannedNote?: string | null;
  bankNote?: string | null;
}): string | null => {
  const parts = [plannedNote, bankNote].map((part) => part?.trim()).filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' | ') : null;
};

/**
 * Write the bank's data into a locked planned row, in place. The instance carries the row
 * lock and firing its hooks is what applies the planned → real balance transition, so the
 * write must stay on this instance rather than going through any id-based helper.
 */
export const mergeIntoPlanned = async ({
  planned,
  incoming,
}: {
  planned: Transactions;
  incoming: IncomingTransactionData;
}): Promise<Transactions> => {
  const commissionRate = incoming.commissionRate ?? Money.zero();
  const isRefCurrency = planned.refCurrencyCode === planned.currencyCode;

  const refAmount = isRefCurrency
    ? planned.amount
    : await calculateRefAmount({
        userId: planned.userId,
        amount: planned.amount,
        baseCode: planned.currencyCode,
        quoteCode: planned.refCurrencyCode,
        date: incoming.time,
      });

  const refCommissionRate = isRefCurrency
    ? commissionRate
    : await calculateRefAmount({
        userId: planned.userId,
        amount: commissionRate,
        baseCode: planned.currencyCode,
        quoteCode: planned.refCurrencyCode,
        date: incoming.time,
      });

  // A locked null payee is a deliberate "no payee" choice; the bank merchant must not override it.
  // Merged rows never reach the post-sync backfill listener, so this is their only chance at a link.
  const payeeId =
    planned.payeeId ??
    (planned.payeeLocked
      ? null
      : await resolvePayeeForIncomingRow({
          ownerUserId: planned.userId,
          rawMerchantName: incoming.rawMerchantName,
          note: incoming.note,
          failureLogMessage: 'Failed to resolve Payee while merging into a planned transaction; leaving it unlinked',
          logContext: { plannedTransactionId: planned.id, accountId: planned.accountId },
        }));

  const originalSource = planned.originalCurrencyCode ? planned : incoming;

  await planned.update({
    refAmount,
    refCommissionRate,
    commissionRate,
    cashbackAmount: incoming.cashbackAmount ?? Money.zero(),
    time: incoming.time,
    originalId: incoming.originalId ?? null,
    accountType: incoming.accountType,
    note: joinNotes({ plannedNote: planned.note, bankNote: incoming.note }),
    externalUrl: planned.externalUrl ?? incoming.externalUrl ?? null,
    externalReference: planned.externalReference ?? incoming.externalReference ?? null,
    location: planned.location ?? incoming.location ?? null,
    originalAmount: originalSource.originalAmount ?? null,
    originalCurrencyCode: originalSource.originalCurrencyCode ?? null,
    externalData: {
      ...incoming.externalData,
      plannedMerge: { mergedAt: new Date().toISOString() },
    },
    payeeId,
    isPlanned: false,
  });

  return planned;
};

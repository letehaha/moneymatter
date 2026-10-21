/**
 * Transaction Serializers
 *
 * Serializes transaction model instances for API responses.
 * Money fields auto-convert via .toNumber().
 * Deserializers convert API decimal inputs to Money.
 */
import { PAYMENT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import type { CategorizationMeta, CurrencyMeta, RecordId, TransactionLocation } from '@bt/shared/types';
import { Money, moneyToApiDecimal, moneyToApiDecimalOrNull } from '@common/types/money';
import type Tags from '@models/tags.model';
import type TransactionGroups from '@models/transaction-groups.model';
import type TransactionSplits from '@models/transaction-splits.model';
import type Transactions from '@models/transactions.model';
import {
  getRawTransactionStatus,
  isPreBookingStatus,
} from '@services/bank-data-providers/enablebanking/utils/transaction-metadata';

// ============================================================================
// Response Types
// ============================================================================

interface TransactionSplitApiResponse {
  id: string;
  categoryId: string;
  amount: number;
  /** `null` while a custom currency has no rate on the transaction's date. */
  refAmount: number | null;
  note: string | null;
  category?: {
    id: string;
    name: string;
    color: string;
    icon: string;
  };
}

export interface TransactionApiResponse {
  id: string;
  amount: number;
  /** `null` while a custom currency has no rate on the transaction's date; see `refAmountMissing`. */
  refAmount: number | null;
  commissionRate: number;
  refCommissionRate: number | null;
  cashbackAmount: number;
  originalAmount: number | null;
  originalCurrencyCode: string | null;
  note: string | null;
  externalUrl: string | null;
  externalReference: string | null;
  location: TransactionLocation | null;
  time: Date;
  userId: number;
  transactionType: string;
  paymentType: string;
  accountId: string;
  categoryId: string | null;
  currencyCode: string;
  accountType: string;
  refCurrencyCode: string | null;
  transferNature: string;
  transferId: string | null;
  originalId: string | null;
  refundLinked: boolean;
  /** `true` while the base-currency amounts could not be computed for a custom currency. */
  refAmountMissing: boolean;
  /** Present on list reads only. */
  hasAttachments?: boolean;
  /** Decimals, symbol and kind of the account currency as the account owner defines them. */
  currencyMeta?: CurrencyMeta;
  isPlanned: boolean;
  /** Set when a bank transaction merged into this row while it was planned. */
  plannedMerge: { mergedAt: string } | null;
  /** Bank reported the row as PDNG/HOLD and has not booked it yet. */
  isPending: boolean;
  payeeId: string | null;
  payeeLocked: boolean;
  /** How this tx's category was assigned (manual / ai / payee_rule / etc.). `null`
   *  means "no rule has stamped this row yet" — the AI categorization listener
   *  uses that as its filter, so the field doubles as a precedence stamp. */
  categorizationMeta: CategorizationMeta | null;
  createdAt: Date;
  updatedAt: Date;
  splits?: TransactionSplitApiResponse[];
  tags?: Array<{
    id: string;
    name: string;
    color: string;
    icon: string | null;
  }>;
  transactionGroups?: Array<{
    id: string;
    name: string;
    /** Full group membership size, independent of how many members are in this fetch
     *  window. Populated when the group include computes the correlated count. */
    transactionCount: number;
  }>;
  /** Recipient who attached this tx to a shared tracker. Present (and possibly `null`)
   *  only on tracker-scoped fetches; absent on the global tx list and on detail lookups
   *  outside a tracker context. `null` means owner-attached (no chip needed in the UI). */
  addedBy?: { id: number; username: string; avatar: string | null } | null;
  /** Whether the caller has write access to this row. The frontend uses this to render
   *  an inert "Transaction Details" dialog (disabled fields, hidden submit/delete) when
   *  the caller can see the tx — typically via a tracker share — but has no write claim
   *  on the parent account. Absent on paths that don't compute it (single-tx writes,
   *  internal fetches). */
  canEdit?: boolean;
}

// ============================================================================
// Request Types (API format with decimal input)
// ============================================================================

interface CreateTransactionRequest {
  amount: number; // decimal from API
  commissionRate?: number;
  destinationAmount?: number;
  note?: string | null;
  externalUrl?: string | null;
  externalReference?: string | null;
  location?: TransactionLocation | null;
  time?: string;
  transactionType: TRANSACTION_TYPES;
  paymentType: PAYMENT_TYPES;
  accountId: RecordId;
  destinationAccountId?: string;
  destinationTransactionId?: string;
  categoryId?: RecordId;
  transferNature: TRANSACTION_TRANSFER_NATURE;
  refundForTxId?: string;
  refundForSplitId?: string;
  splits?: Array<{
    categoryId: RecordId;
    amount: number; // decimal from API
    note?: string | null;
  }>;
  tagIds?: string[];
  payeeId?: RecordId | null;
  payeeLocked?: boolean;
  isPlanned?: boolean;
  applyAutomations?: boolean;
  originalAmount?: number; // decimal from API
  originalCurrencyCode?: string;
}

// ============================================================================
// Internal Types (DB format with Money)
// ============================================================================

interface CreateTransactionInternal {
  amount: Money;
  commissionRate?: Money;
  destinationAmount?: Money;
  note?: string;
  externalUrl?: string;
  externalReference?: string;
  /** `null` is the caller's explicit "no location" and blocks the payee default; absent means "not mentioned". */
  location?: TransactionLocation | null;
  time?: Date;
  transactionType: TRANSACTION_TYPES;
  paymentType: PAYMENT_TYPES;
  accountId: RecordId;
  destinationAccountId?: string;
  destinationTransactionId?: string;
  categoryId?: RecordId;
  transferNature: TRANSACTION_TRANSFER_NATURE;
  refundsTxId?: string;
  refundsSplitId?: string;
  splits?: Array<{
    categoryId: RecordId;
    amount: Money;
    note?: string | null;
  }>;
  tagIds?: string[];
  userId: number;
  payeeId?: RecordId | null;
  payeeLocked?: boolean;
  isPlanned?: boolean;
  applyAutomations?: boolean;
  originalAmount?: Money;
  originalCurrencyCode?: string;
}

// ============================================================================
// Serializers (DB → API)
// ============================================================================

/**
 * Serialize a transaction split from DB format to API response
 */
function serializeTransactionSplit(
  split: TransactionSplits & { category?: { id: string; name: string; color: string; icon: string } },
): TransactionSplitApiResponse {
  return {
    id: split.id,
    categoryId: split.categoryId,
    amount: moneyToApiDecimal(split.amount),
    refAmount: moneyToApiDecimalOrNull(split.refAmount),
    note: split.note,
    ...(split.category && {
      category: {
        id: split.category.id,
        name: split.category.name,
        color: split.category.color,
        icon: split.category.icon,
      },
    }),
  };
}

function extractPlannedMerge({ externalData }: { externalData: unknown }): { mergedAt: string } | null {
  const mergedAt = (externalData as { plannedMerge?: { mergedAt?: unknown } } | null)?.plannedMerge?.mergedAt;
  return typeof mergedAt === 'string' ? { mergedAt } : null;
}

/**
 * Serialize a transaction from DB format to API response
 */
export function serializeTransaction(
  tx: Transactions & {
    splits?: TransactionSplits[];
    tags?: Tags[];
    transactionGroups?: TransactionGroups[];
    addedBy?: { id: number; username: string; avatar: string | null } | null;
    canEdit?: boolean;
    currencyMeta?: CurrencyMeta;
  },
): TransactionApiResponse {
  // Aliased literal: a plain property on raw rows, dataValues-only on model instances.
  const hasAttachments = (tx.getDataValue?.('hasAttachments' as keyof Transactions) ??
    (tx as { hasAttachments?: boolean }).hasAttachments) as boolean | undefined;

  return {
    id: tx.id,
    amount: moneyToApiDecimal(tx.amount),
    refAmount: moneyToApiDecimalOrNull(tx.refAmount),
    commissionRate: moneyToApiDecimal(tx.commissionRate),
    refCommissionRate: moneyToApiDecimalOrNull(tx.refCommissionRate),
    cashbackAmount: moneyToApiDecimal(tx.cashbackAmount),
    originalAmount: moneyToApiDecimalOrNull(tx.originalAmount),
    originalCurrencyCode: tx.originalCurrencyCode ?? null,
    note: tx.note,
    externalUrl: tx.externalUrl ?? null,
    externalReference: tx.externalReference ?? null,
    location: tx.location ?? null,
    time: tx.time,
    userId: tx.userId,
    transactionType: tx.transactionType,
    paymentType: tx.paymentType,
    accountId: tx.accountId,
    categoryId: tx.categoryId,
    currencyCode: tx.currencyCode,
    accountType: tx.accountType,
    refCurrencyCode: tx.refCurrencyCode,
    transferNature: tx.transferNature,
    transferId: tx.transferId,
    originalId: tx.originalId,
    refundLinked: tx.refundLinked,
    refAmountMissing: tx.refAmountMissing ?? false,
    isPlanned: tx.isPlanned ?? false,
    plannedMerge: extractPlannedMerge({ externalData: tx.externalData }),
    isPending: isPreBookingStatus({ status: getRawTransactionStatus({ externalData: tx.externalData }) }),
    payeeId: tx.payeeId ?? null,
    payeeLocked: tx.payeeLocked ?? false,
    categorizationMeta: tx.categorizationMeta ?? null,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
    ...(tx.splits && {
      splits: tx.splits.map((split) =>
        serializeTransactionSplit(
          split as TransactionSplits & { category?: { id: string; name: string; color: string; icon: string } },
        ),
      ),
    }),
    ...(tx.tags && {
      tags: tx.tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        icon: tag.icon,
      })),
    }),
    ...(tx.transactionGroups && {
      transactionGroups: tx.transactionGroups.map((group) => ({
        id: group.id,
        name: group.name,
        // Attached via a correlated subquery on the include, so it lives in dataValues
        // (no model getter for aliased literals) and must be read with getDataValue.
        // Falls back to the loaded-member count on paths that don't compute the aggregate.
        transactionCount:
          (group.getDataValue('transactionCount' as keyof TransactionGroups) as number | undefined) ??
          group.transactions?.length ??
          0,
      })),
    }),
    // `addedBy` is included whenever the upstream service attached it (tracker-scoped
    // fetches). `null` is a meaningful value — "owner-attached" — and must be sent so
    // the frontend can distinguish "no metadata yet" from "tx is owned by the tracker
    // owner". Use a property-existence check rather than truthiness to preserve null.
    ...('addedBy' in tx ? { addedBy: tx.addedBy ?? null } : {}),
    // `canEdit` is omitted on paths that don't compute it (write returns, internal
    // fetches). Property-existence check so an explicit `false` survives serialization.
    ...('canEdit' in tx ? { canEdit: tx.canEdit ?? false } : {}),
    ...(hasAttachments !== undefined && { hasAttachments }),
    ...(tx.currencyMeta && { currencyMeta: tx.currencyMeta }),
  };
}

/**
 * Serialize multiple transactions
 */
export function serializeTransactions(
  txs: Array<
    Transactions & {
      splits?: TransactionSplits[];
      tags?: Tags[];
      transactionGroups?: TransactionGroups[];
      addedBy?: { id: number; username: string; avatar: string | null } | null;
      canEdit?: boolean;
    }
  >,
): TransactionApiResponse[] {
  return txs.map(serializeTransaction);
}

/**
 * Serialize a transaction tuple result from create/update operations.
 * These operations return [baseTx, oppositeTx?] for transfer transactions.
 */
export function serializeTransactionTuple(
  result: [baseTx: Transactions, oppositeTx?: Transactions],
): [TransactionApiResponse, TransactionApiResponse?] {
  const [baseTx, oppositeTx] = result;
  return oppositeTx ? [serializeTransaction(baseTx), serializeTransaction(oppositeTx)] : [serializeTransaction(baseTx)];
}

// ============================================================================
// Deserializers (API → DB)
// ============================================================================

/**
 * Deserialize a create transaction request from API decimal format to internal `Money` values
 */
export function deserializeCreateTransaction(req: CreateTransactionRequest, userId: number): CreateTransactionInternal {
  return {
    amount: Money.fromDecimal(req.amount),
    commissionRate: req.commissionRate !== undefined ? Money.fromDecimal(req.commissionRate) : undefined,
    destinationAmount: req.destinationAmount !== undefined ? Money.fromDecimal(req.destinationAmount) : undefined,
    note: req.note || undefined,
    externalUrl: req.externalUrl || undefined,
    externalReference: req.externalReference || undefined,
    location: req.location,
    time: req.time ? new Date(req.time) : undefined,
    transactionType: req.transactionType,
    paymentType: req.paymentType,
    accountId: req.accountId,
    destinationAccountId: req.destinationAccountId,
    destinationTransactionId: req.destinationTransactionId,
    categoryId: req.categoryId,
    transferNature: req.transferNature,
    refundsTxId: req.refundForTxId,
    refundsSplitId: req.refundForSplitId,
    splits: req.splits?.map((split) => ({
      categoryId: split.categoryId,
      amount: Money.fromDecimal(split.amount),
      note: split.note,
    })),
    tagIds: req.tagIds,
    userId,
    payeeId: req.payeeId,
    payeeLocked: req.payeeLocked,
    isPlanned: req.isPlanned,
    applyAutomations: req.applyAutomations,
    originalAmount: req.originalAmount !== undefined ? Money.fromDecimal(req.originalAmount) : undefined,
    originalCurrencyCode: req.originalCurrencyCode,
  };
}

import {
  ACCOUNT_TYPES,
  BLANK_FILTER_VALUE,
  CATEGORIZATION_SOURCE,
  FILTER_OPERATION,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { booleanQuery, dateRange, recordId, withDateOrder } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { z } from 'zod';

const parseCommaSeparatedStrings = (value: string) =>
  value
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean);

const idOrBlank = z.union([recordId(), z.literal(BLANK_FILTER_VALUE)]);

const csvArray = <T extends z.ZodTypeAny>({ item }: { item: T }) =>
  z.preprocess((val) => (typeof val === 'string' ? parseCommaSeparatedStrings(val) : val), z.array(item));

/** Which rows match, with no pagination, sorting or response-shape flags: shared by
 *  the list, its summary, and bulk actions targeting "everything matching". */
export const transactionFilterFields = {
  // Exact set of transferNature values to include. Supersedes transferFilter when present.
  transferNatures: csvArray({ item: z.nativeEnum(TRANSACTION_TRANSFER_NATURE) }).optional(),
  ...dateRange({ precision: 'datetime' }),
  transactionType: z.nativeEnum(TRANSACTION_TYPES).optional(),
  accountType: z.nativeEnum(ACCOUNT_TYPES).optional(),
  accountIds: csvArray({ item: recordId() }).optional(),
  budgetIds: csvArray({ item: recordId() }).optional(),
  excludedBudgetIds: csvArray({ item: recordId() }).optional(),
  tagIds: csvArray({ item: idOrBlank }).optional(),
  excludedTagIds: csvArray({ item: recordId() }).optional(),
  categoryIds: csvArray({ item: recordId() }).optional(),
  payeeIds: csvArray({ item: idOrBlank }).optional(),
  excludeAccountIds: csvArray({ item: recordId() }).optional(),
  excludeTransfer: booleanQuery().optional(),
  excludeRefunds: booleanQuery().optional(),
  // Excludes the refund side of refund links; originals that carry refunds stay.
  excludeRefundTxs: booleanQuery().optional(),
  // With excludeRefundTxs: keep refunds linked to this transaction visible.
  keepRefundsForTxId: recordId().optional(),
  excludeBalanceAdjustments: booleanQuery().optional(),
  // Absent = both, true = only with attachments, false = only without.
  hasAttachment: booleanQuery().optional(),
  // Absent = both, true = only planned, false = exclude planned.
  isPlanned: booleanQuery().optional(),
  transferFilter: z.nativeEnum(FILTER_OPERATION).optional(),
  refundFilter: z.nativeEnum(FILTER_OPERATION).optional(),
  // Amount filters accept decimals from API
  amountLte: z.preprocess((val) => Number(val), z.number().positive()).optional(),
  amountGte: z.preprocess((val) => Number(val), z.number().positive()).optional(),
  noteSearch: z
    .string()
    .optional()
    .refine((val) => val !== '[object Object]', {
      message: 'Invalid noteSearch value: received object instead of string',
    })
    .transform((val) => {
      if (!val || val === '') return undefined;
      return parseCommaSeparatedStrings(val);
    }),
  categorizationSource: z.nativeEnum(CATEGORIZATION_SOURCE).optional(),
  categorizedAt: z.string().datetime().optional(),
  batchId: recordId().optional(),
};

export const isAmountRangeOrdered = (data: { amountGte?: number; amountLte?: number }) =>
  !data.amountGte || !data.amountLte || data.amountGte <= data.amountLte;

export const amountRangeIssue = {
  message: 'amountGte must be less than or equal to amountLte',
  path: ['amountGte'],
};

export const transactionFiltersSchema = withDateOrder(
  z.object(transactionFilterFields).refine(isAmountRangeOrdered, amountRangeIssue),
);

/**
 * The endpoints speak the shared request vocabulary (`from`/`to` date range, decimal
 * amounts); the transactions model date-filters on `startDate`/`endDate` and compares
 * amounts as `Money`. Both are mapped here, at the HTTP boundary.
 */
export const toServiceFilters = <T extends { from?: string; to?: string; amountGte?: number; amountLte?: number }>({
  from,
  to,
  amountGte,
  amountLte,
  ...rest
}: T) => ({
  ...rest,
  startDate: from,
  endDate: to,
  amountGte: amountGte !== undefined ? Money.fromDecimal(amountGte) : undefined,
  amountLte: amountLte !== undefined ? Money.fromDecimal(amountLte) : undefined,
});

/** A bulk action targets either explicit ids or everything matching the list filters. */
export const bulkTargetFields = {
  transactionIds: z.array(recordId()).min(1, 'At least one transaction ID required').optional(),
  selection: z
    .object({
      // Strict: an unknown key silently dropped here would widen a destructive action.
      filters: withDateOrder(z.object(transactionFilterFields).strict().refine(isAmountRangeOrdered, amountRangeIssue)),
      excludedIds: z.array(recordId()).optional().default([]),
    })
    .optional(),
};

export const hasOneBulkTarget = (data: { transactionIds?: unknown; selection?: unknown }) =>
  (data.transactionIds === undefined) !== (data.selection === undefined);

export const bulkTargetIssue = { message: 'Provide either transactionIds or selection, not both' };

/** The validated bulk target, with its filters mapped for the service layer. */
export const toBulkTarget = ({
  transactionIds,
  selection,
}: {
  transactionIds?: string[];
  selection?: { filters: z.infer<typeof transactionFiltersSchema>; excludedIds: string[] };
}) => ({
  transactionIds,
  selection: selection && { filters: toServiceFilters(selection.filters), excludedIds: selection.excludedIds },
});

import {
  ACCOUNT_TYPES,
  BLANK_FILTER_VALUE,
  CATEGORIZATION_SOURCE,
  FILTER_OPERATION,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import {
  bulkTargetFields,
  bulkTargetIssue,
  hasOneBulkTarget,
  toBulkTarget,
  toServiceFilters,
  transactionFiltersSchema,
} from '@controllers/transactions.controller/transaction-filters';
import { z } from 'zod';

const idOrBlank = z.union([recordId(), z.literal(BLANK_FILTER_VALUE)]);

/**
 * The fields of `transactionFilterFields` (the REST list, summary and bulk-action filters) as a
 * plain shape the SDK can publish. The REST fields preprocess comma-separated strings and
 * transform their output, which a published schema cannot describe, so each field is restated
 * here and the handler validates the arguments again with the REST schema. A unit test keeps
 * the two key sets equal.
 */
export const transactionFilterInput = {
  from: z.string().optional().describe('Start of the date range (ISO 8601 datetime in UTC, e.g. 2026-10-01T00:00:00Z)'),
  to: z.string().optional().describe('End of the date range (ISO 8601 datetime in UTC). Must not precede from'),
  transactionType: z.nativeEnum(TRANSACTION_TYPES).optional().describe('Only income, expense or transfer rows'),
  transferNatures: z
    .array(z.nativeEnum(TRANSACTION_TRANSFER_NATURE))
    .optional()
    .describe('Exact set of transfer natures to include. Replaces transferFilter and excludeTransfer when set'),
  accountType: z.nativeEnum(ACCOUNT_TYPES).optional().describe('Only rows on accounts of this type'),
  accountIds: z.array(recordId()).optional().describe('Only rows on these account IDs'),
  excludeAccountIds: z.array(recordId()).optional().describe('Leave out rows on these account IDs'),
  budgetIds: z.array(recordId()).optional().describe('Only rows linked to these tracker (budget) IDs'),
  excludedBudgetIds: z.array(recordId()).optional().describe('Leave out rows linked to these tracker (budget) IDs'),
  categoryIds: z.array(recordId()).optional().describe('Only rows in these category IDs'),
  tagIds: z
    .array(idOrBlank)
    .optional()
    .describe(`Only rows with these tag IDs; "${BLANK_FILTER_VALUE}" matches rows with no tag`),
  excludedTagIds: z.array(recordId()).optional().describe('Leave out rows with these tag IDs'),
  payeeIds: z
    .array(idOrBlank)
    .optional()
    .describe(
      `Only rows with these payee (merchant) IDs; "${BLANK_FILTER_VALUE}" matches rows with no payee. get_payees resolves a name to an id`,
    ),
  amountGte: z.number().optional().describe('Minimum amount (positive decimal, in the original currency)'),
  amountLte: z.number().optional().describe('Maximum amount (positive decimal, in the original currency)'),
  noteSearch: z.string().optional().describe('Search the note: comma-separated terms'),
  isPlanned: z
    .boolean()
    .optional()
    .describe('true: only your planned transactions; false: leave plans out. Omit for real rows plus your plans'),
  hasAttachment: z.boolean().optional().describe('true: only rows with attachments; false: only rows without'),
  excludeTransfer: z.boolean().optional().describe('Leave out transfers'),
  excludeRefunds: z.boolean().optional().describe('Leave out refunds'),
  excludeRefundTxs: z
    .boolean()
    .optional()
    .describe('Leave out the refund side of refund links; originals that carry refunds stay'),
  keepRefundsForTxId: recordId().optional().describe('With excludeRefundTxs: keep refunds linked to this transaction'),
  excludeBalanceAdjustments: z.boolean().optional().describe('Leave out balance adjustments'),
  transferFilter: z
    .nativeEnum(FILTER_OPERATION)
    .optional()
    .describe('Transfers: include, exclude or only. Superseded by transferNatures'),
  refundFilter: z.nativeEnum(FILTER_OPERATION).optional().describe('Refunds: include, exclude or only'),
  categorizationSource: z.nativeEnum(CATEGORIZATION_SOURCE).optional().describe('How the category was assigned'),
  categorizedAt: z.string().optional().describe('Only rows categorized at this ISO 8601 datetime'),
  batchId: recordId().optional().describe('Only rows from this import batch'),
};

/** The filters, validated by the schema the REST list and summary use and mapped for the service. */
export function parseTransactionFilters({ filters }: { filters: unknown }) {
  return toServiceFilters(transactionFiltersSchema.parse(filters));
}

/**
 * Whether a filter set narrows the selection at all, judged on the filters the REST schema
 * parsed (what `parseBulkTarget` returns), not on the arguments as sent: a value counts only
 * when it restricts the WHERE clause the service builds. So an empty or all-separator
 * `noteSearch` (the schema turns it into no terms), an empty list, an exclude flag that is off,
 * the `all` operation (including one that overrides a legacy `excludeTransfer`/`excludeRefunds`
 * flag) and a lone `keepRefundsForTxId` (only read together with `excludeRefundTxs`) all select
 * everything. REST lets a bulk action run with such filters, which selects every transaction
 * the caller owns; an AI client must not delete that much by sending nothing that filters.
 */
export function hasNarrowingFilter({ filters }: { filters: ReturnType<typeof parseTransactionFilters> }): boolean {
  const hasItems = (list: readonly unknown[] | undefined) => !!list?.length;

  // The model lets the enum operation win over the legacy boolean, and `all` restricts nothing.
  const transferOperation = filters.transferFilter ?? (filters.excludeTransfer ? FILTER_OPERATION.exclude : undefined);
  const refundOperation = filters.refundFilter ?? (filters.excludeRefunds ? FILTER_OPERATION.exclude : undefined);
  const restrictsTransfers =
    hasItems(filters.transferNatures) || (transferOperation ?? FILTER_OPERATION.all) !== FILTER_OPERATION.all;
  const restrictsRefunds = (refundOperation ?? FILTER_OPERATION.all) !== FILTER_OPERATION.all;

  const hasList = [
    filters.accountIds,
    filters.excludeAccountIds,
    filters.budgetIds,
    filters.excludedBudgetIds,
    filters.categoryIds,
    filters.tagIds,
    filters.excludedTagIds,
    filters.payeeIds,
    filters.noteSearch,
  ].some(hasItems);

  const hasValue = [
    filters.startDate,
    filters.endDate,
    filters.amountGte,
    filters.amountLte,
    filters.transactionType,
    filters.accountType,
    filters.categorizationSource,
    filters.categorizedAt,
    filters.batchId,
  ].some((value) => value !== undefined && value !== null);

  // A flag counts only when switched on. `false` on an exclude flag changes nothing, and `false` on
  // isPlanned or hasAttachment still keeps nearly every row, so it is no basis for a delete either.
  const hasFlag = [
    filters.isPlanned,
    filters.hasAttachment,
    filters.excludeRefundTxs,
    filters.excludeBalanceAdjustments,
  ].some((flag) => flag === true);

  return restrictsTransfers || restrictsRefunds || hasList || hasValue || hasFlag;
}

const bulkTargetSchema = z.object(bulkTargetFields).refine(hasOneBulkTarget, bulkTargetIssue);

/**
 * A bulk action's target, validated by the schema `POST /transactions/bulk-delete` uses: explicit
 * ids, or a selection of strict filters (an unknown key is refused, never dropped) less the
 * excluded ids.
 */
export function parseBulkTarget({
  transactionIds,
  filters,
  excludedIds,
}: {
  transactionIds?: string[];
  filters?: unknown;
  excludedIds?: string[];
}) {
  if (transactionIds !== undefined && excludedIds !== undefined) {
    throw new Error('"excludedIds" only applies together with "filters"');
  }

  return toBulkTarget(
    bulkTargetSchema.parse({
      transactionIds,
      selection: filters === undefined ? undefined : { filters, excludedIds },
    }),
  );
}

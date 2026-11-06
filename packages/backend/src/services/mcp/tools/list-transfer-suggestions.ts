import { serializeTransaction } from '@root/serializers/transactions.serializer';
import { bulkScanTransferRecommendations } from '@services/transactions/transactions-linking/bulk-scan-transfer-recommendations.service';
import {
  BULK_SCAN_DEFAULT_LIMIT,
  BULK_SCAN_MAX_LIMIT,
  bulkScanBodySchema,
} from '@services/transactions/transactions-linking/recommendation-schemas';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { presentTransactions } from './transaction-output';

export const listTransferSuggestionsTool = defineTool({
  name: 'list_transfer_suggestions',
  toolset: 'review',
  access: 'read',
  // POST /transactions/transfer-recommendations/bulk-scan carries the base-currency lock in REST,
  // though it only reads.
  lock: true,
  description:
    "Scan a period for expenses that look like one leg of a transfer between the caller's accounts. Returns { total, items }: each item is an expense with up to 4 candidate incomes on other accounts (within 10% in the base currency and 14 days) and a confidence from 0 to 100, newest expense first, paged by limit and offset. Pairs already dismissed are left out. Reads only: nothing is linked. Link a pair with link_transfer; dismiss a wrong one with dismiss_transfer_suggestion. Refused while a base-currency change is running.",
  // Restates the REST body fields so the SDK can publish them; run validates with the REST
  // schema, and a unit test keeps the two key sets equal.
  input: {
    from: z.string().describe('Start of the period (ISO 8601 datetime, e.g. 2026-09-01T00:00:00Z)'),
    to: z.string().describe('End of the period (ISO 8601 datetime). Must not precede from'),
    limit: z
      .number()
      .int()
      .positive()
      .max(BULK_SCAN_MAX_LIMIT)
      .optional()
      .describe(`Expenses per page, 1 to ${BULK_SCAN_MAX_LIMIT} (default ${BULK_SCAN_DEFAULT_LIMIT})`),
    offset: z.number().int().min(0).optional().describe('Expenses to skip, for the next page (default 0)'),
    includeOutOfWallet: z
      .boolean()
      .optional()
      .describe('Also offer expenses and incomes marked as transfers out of the wallet (default false)'),
  },
  run: async ({ userId, args }) => {
    const body = bulkScanBodySchema.parse(args);
    const { total, items } = await bulkScanTransferRecommendations({ userId, ...body });

    const serialized = items.map((item) => ({
      expense: serializeTransaction(item.expense),
      matches: item.matches.map((match) => ({
        transaction: serializeTransaction(match.transaction),
        confidence: match.confidence,
      })),
    }));
    const slimById = new Map(
      (
        await presentTransactions({
          userId,
          transactions: serialized.flatMap((item) => [item.expense, ...item.matches.map((m) => m.transaction)]),
        })
      ).map((tx) => [tx.id, tx]),
    );

    return {
      total,
      items: serialized.map((item) => ({
        expense: slimById.get(item.expense.id),
        matches: item.matches.map((match) => ({
          transaction: slimById.get(match.transaction.id),
          confidence: match.confidence,
        })),
      })),
    };
  },
});

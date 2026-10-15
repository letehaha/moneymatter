import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { queueStatementImport } from '@services/import-export/statement-parser/statement-import-queue';
import { z } from 'zod';

const extractedTransactionSchema = z
  .object({
    date: z.string(),
    description: z.string(),
    /** Drives payee linking and payee-rule categorization; zod strips it from the body when unlisted. */
    merchant: z.string().optional(),
    amount: z.number().positive(),
    type: z.enum(['income', 'expense']),
    originalAmount: z.number().positive().finite().optional(),
    originalCurrencyCode: currencyCode().optional(),
    externalReference: z.string().max(255).optional(),
  })
  .refine((data) => (data.originalAmount === undefined) === (data.originalCurrencyCode === undefined), {
    message: '"originalAmount" and "originalCurrencyCode" must be provided together',
    path: ['originalAmount', 'originalCurrencyCode'],
  });

/**
 * Execute statement import - create transactions in the database
 *
 * Enqueues a background job and answers with its id; the client follows it via
 * GET /import/text-source/execute/status/:jobId.
 * Best-effort: each transaction is persisted independently, so a row that fails
 * is reported in `summary.errors` while the rest are still imported.
 */
export const executeImportController = createController(
  z.object({
    body: z.object({
      /** Account ID to import transactions to */
      accountId: recordId(),
      /** Extracted transactions to import */
      transactions: z.array(extractedTransactionSchema),
      /** Transaction indices to skip (confirmed duplicates) */
      skipIndices: z.array(z.number().int().nonnegative()),
      timezone: z.string().min(1).optional(),
    }),
  }),
  async ({ user, body }) => {
    const { accountId, transactions, skipIndices, timezone } = body;

    const jobId = await queueStatementImport({
      userId: user.id,
      accountId,
      transactions,
      skipIndices,
      timezone,
    });

    return { data: { jobId } };
  },
);

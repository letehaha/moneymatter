import {
  INVESTMENT_IMPORT_SIDE_SKIP,
  INVESTMENT_TRANSACTION_CATEGORY,
  type InvestmentImportExtractionResult,
  type InvestmentImportWarning,
} from '@bt/shared/types/investments';
import { recordId } from '@common/lib/zod/custom-types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { toAiExtractionHttpError } from '@controllers/helpers/ai-extraction-http-error';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import { CustomError, UnexpectedError } from '@js/errors';
import { logger } from '@js/utils';
import Portfolios from '@models/investments/portfolios.model';
import {
  extractInvestmentTransactionsWithAI,
  groupRowsIntoHoldings,
  parseInvestmentCsv,
} from '@services/import-export/investment-transactions-parser';
import {
  extractTextFromFile,
  resolveTextExtractionSuggestion,
  validateFileBuffer,
} from '@services/import-export/statement-parser';
import { z } from 'zod';

/**
 * Schema for the user-supplied CSV column mapping. The shape mirrors the
 * shared `InvestmentColumnMapping` type. Side-value mapping is a record of
 * raw CSV values → enum categories so brokers using different vocabularies
 * (B/S, Buy/Sell, Compra/Venta) can all be parsed by the same pipeline.
 */
const columnMappingSchema = z.object({
  symbol: z.string().min(1),
  date: z.string().min(1),
  side: z.string().min(1),
  quantity: z.string().min(1),
  price: z.string().min(1),
  fees: z.string().nullable(),
  currency: z.string().nullable(),
  name: z.string().nullable(),
  defaultCurrency: z.string().nullable(),
  defaultAssetClassHint: z.enum(['crypto', 'stocks']),
  sideValueMapping: z.record(
    z.string(),
    z.union([z.nativeEnum(INVESTMENT_TRANSACTION_CATEGORY), z.literal(INVESTMENT_IMPORT_SIDE_SKIP)]),
  ),
});

// Discriminated union on `source` — Zod produces a clean
// "you forgot columnMapping" error when source='csv' is missing fields,
// rather than the combined per-branch errors a plain `z.union` would emit.
// `source` itself defaults to 'ai' so existing callers that don't know about
// the discriminator keep working.
const aiBody = z.object({
  source: z.literal('ai'),
  fileBase64: z.string().min(1, 'File content is required'),
  defaultPortfolioId: recordId(),
});

const csvBody = z.object({
  source: z.literal('csv'),
  fileBase64: z.string().min(1, 'File content is required'),
  defaultPortfolioId: recordId(),
  columnMapping: columnMappingSchema,
});

const extractBodySchema = z.preprocess(
  (val) => (val && typeof val === 'object' && !('source' in val) ? { ...val, source: 'ai' } : val),
  z.discriminatedUnion('source', [aiBody, csvBody]),
);

/**
 * Extract investment transactions — either via AI from any supported file
 * (CSV/PDF/TXT) or via direct CSV parsing with a user-supplied column mapping.
 *
 * Both paths converge at `groupRowsIntoHoldings`, so the response shape is
 * identical (`InvestmentImportExtractionResult`) and the review UI doesn't
 * need to care which path produced it.
 */
export const extractController = createController(
  z.object({
    body: extractBodySchema,
  }),
  async ({ user, body }) => {
    try {
      return await extractHandler({ userId: user.id, body });
    } catch (err) {
      if (err instanceof CustomError) throw err;
      // Don't echo the raw error string to the client — provider 401s, DB
      // connection messages, and stack-trace fragments would leak through.
      // The full error is logged for server-side debugging.
      logger.error({ message: 'Investment txn import extract failed', error: err as Error });
      throw new UnexpectedError({ message: t({ key: 'investments.import.extractFailed' }) });
    }
  },
);

type ExtractBody = z.infer<typeof extractBodySchema>;

async function extractHandler({ userId, body }: { userId: number; body: ExtractBody }) {
  // Check portfolio ownership BEFORE doing any work. Without this guard a user
  // could pass an arbitrary portfolio id and we'd happily run extraction
  // (burning AI tokens or CSV parse cycles) against it. The error becomes a
  // 404 via NotFoundError, which the frontend's `isResourceMissingError`
  // already routes to its not-found state.
  await findOrThrowNotFound({
    query: Portfolios.findOne({ where: { id: body.defaultPortfolioId, userId } }),
    message: t({ key: 'investments.portfolioNotFound' }),
  });

  if (body.source === 'csv') {
    return await extractFromCsv({ userId, body });
  }
  return await extractFromAi({ userId, body });
}

async function extractFromAi({ userId, body }: { userId: number; body: z.infer<typeof aiBody> }) {
  const rawBuffer = Buffer.from(body.fileBase64, 'base64');
  const validation = validateFileBuffer({ buffer: rawBuffer });
  if (!validation.valid) {
    throw new UnexpectedError({ message: validation.error.message });
  }

  const textResult = await extractTextFromFile({
    buffer: validation.fileBuffer,
    fileType: validation.fileType,
  });
  if (!textResult.success) {
    throw new UnexpectedError({
      message: resolveTextExtractionSuggestion({ fileType: validation.fileType, errorCode: textResult.errorCode }),
    });
  }

  const aiResult = await extractInvestmentTransactionsWithAI({
    userId,
    text: textResult.text!,
  });

  if (!aiResult.success) {
    throw toAiExtractionHttpError({ error: aiResult.error });
  }

  // Surface rows the AI parser silently dropped. Without this warning the user
  // would see N transactions in the review step having uploaded a file that
  // contained more — and assume the source had only N trades.
  const extraWarnings: InvestmentImportWarning[] = [];
  if (aiResult.result.droppedRowCount > 0) {
    extraWarnings.push({ code: 'AI_ROWS_DROPPED', params: { count: aiResult.result.droppedRowCount } });
  }

  const { holdings, warnings } = await groupRowsIntoHoldings({
    rows: aiResult.result.rows,
    userId,
    defaultPortfolioId: body.defaultPortfolioId,
    extraWarnings,
  });

  return {
    data: {
      holdings,
      warnings,
      fileType: validation.fileType,
      tokenCount: aiResult.result.tokenCount,
    } satisfies InvestmentImportExtractionResult,
  };
}

async function extractFromCsv({ userId, body }: { userId: number; body: z.infer<typeof csvBody> }) {
  const fileContent = Buffer.from(body.fileBase64, 'base64').toString('utf-8');

  const { rows, invalidRows, totalRows, skippedRowsCount } = parseInvestmentCsv({
    fileContent,
    columnMapping: body.columnMapping,
  });

  // Surface validation failures so the user knows N rows didn't make it into
  // the review step. Cap detail lines so the warnings array stays readable —
  // first 5 reasons + a summary count covers the common cases without dumping
  // 50K row indices on a malformed file.
  const extraWarnings: InvestmentImportWarning[] = [];
  if (invalidRows.length > 0) {
    extraWarnings.push({ code: 'CSV_ROWS_INVALID', params: { count: invalidRows.length, total: totalRows } });
    for (const { rowIndex, code, value } of invalidRows.slice(0, 5)) {
      extraWarnings.push({ code, params: { row: rowIndex, ...(value !== undefined && { value }) } });
    }
  }
  if (skippedRowsCount > 0) {
    // Separate from invalidRows because these are deliberate, not failures.
    // Without this warning the user wonders why their 500-row file produced
    // only 300 transactions.
    extraWarnings.push({ code: 'CSV_ROWS_SKIPPED', params: { count: skippedRowsCount } });
  }

  const { holdings, warnings } = await groupRowsIntoHoldings({
    rows,
    userId,
    defaultPortfolioId: body.defaultPortfolioId,
    extraWarnings,
  });

  return {
    data: {
      holdings,
      warnings,
      fileType: 'csv',
      tokenCount: { input: 0, output: 0 },
    } satisfies InvestmentImportExtractionResult,
  };
}

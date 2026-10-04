import {
  AccountOptionValue,
  CategoryOptionValue,
  CurrencyOptionValue,
  TransactionTypeOptionValue,
} from '@bt/shared/types';
import type {
  AccountMappingConfig,
  AiMapImportCategoriesResponse,
  BudgetBakersWalletAccountMapping,
  BudgetBakersWalletImportProgress,
  CategoryMappingConfig,
  ColumnMappingConfig,
  CsvImportProgress,
  DeleteImportBatchResponse,
  DetectBudgetBakersWalletDuplicatesResponse,
  DetectDuplicatesResponse,
  DetectMsMoneyDuplicatesResponse,
  DetectOfxDuplicatesResponse,
  ExecuteBudgetBakersWalletResponse,
  ExecuteImportResponse,
  ExecuteMsMoneyResponse,
  ExecuteOfxRequest,
  ExecuteOfxResponse,
  ExecuteYnabResponse,
  ExtractedMetadata,
  ExtractedTransaction,
  ExtractUniqueValuesResponse,
  ImportBatchDeleteActiveStatus,
  ImportBatchesHistoryResponse,
  MsMoneyAccountMapping,
  MsMoneyImportProgress,
  MsMoneyUploadResponse,
  OfxAccountMapping,
  OfxImportProgress,
  OfxUploadResponse,
  ParseBudgetBakersWalletResponse,
  ParseYnabResponse,
  StatementCostEstimate,
  StatementDetectDuplicatesResponse,
  StatementExecuteImportQueuedResponse,
  StatementExtractionResult,
  StatementImportProgress,
  StatementImportSummary,
  TagMappingConfig,
  YnabAccountMapping,
  YnabImportProgress,
} from '@bt/shared/types';
import { app } from '@root/app';
import { API_PREFIX } from '@root/config';
import { readMsMoneyFixture } from '@tests/fixtures/ms-money-fixtures';
import fs from 'fs';
import path from 'path';
import request from 'supertest';

import { type UtilizeReturnType, makeRequest } from './common';

// Path to CSV fixtures
const FIXTURES_PATH = path.join(__dirname, '../fixtures/csv-import');
const STATEMENT_FIXTURES_PATH = path.join(__dirname, '../fixtures');
const YNAB_FIXTURES_PATH = path.join(__dirname, '../fixtures/ynab-import');
const BUDGET_BAKERS_WALLET_FIXTURES_PATH = path.join(__dirname, '../fixtures/budget-bakers-wallet-import');
const OFX_FIXTURES_PATH = path.join(__dirname, '../fixtures/ofx-import');

/** Load a committed, sanitized OFX/QFX fixture as raw upload bytes. */
export function loadOfxFixture({ filename }: { filename: string }): Buffer {
  return fs.readFileSync(path.join(OFX_FIXTURES_PATH, filename));
}

/** Load a YNAB Register.csv fixture by filename. */
export function loadYnabFixture(filename: string): string {
  const filePath = path.join(YNAB_FIXTURES_PATH, filename);
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Load a statement fixture file by name (JSON format)
 */
export function loadStatementFixture(filename: string): {
  transactions: ExtractedTransaction[];
  metadata: ExtractedMetadata;
} {
  const filePath = path.join(STATEMENT_FIXTURES_PATH, filename);
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Load a CSV fixture file by name
 */
export function loadCsvFixture(filename: string): string {
  const filePath = path.join(FIXTURES_PATH, filename);
  return fs.readFileSync(filePath, 'utf-8');
}

// ============================================
// Parse CSV Endpoint
// ============================================

interface ParseCsvResponse {
  headers: string[];
  preview: Record<string, string>[];
  detectedDelimiter: string;
  totalRows: number;
}

interface ParseCsvParams {
  fileContent: string;
  delimiter?: string;
}

export function parseCsv<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: ParseCsvParams;
  raw?: R;
}): UtilizeReturnType<() => ParseCsvResponse, R> {
  return makeRequest<ParseCsvResponse, R>({
    method: 'post',
    url: '/import/csv/parse',
    payload,
    raw,
  });
}

// ============================================
// AI Category Mapping Endpoint
// ============================================

export function aiMapImportCategories<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: { sourceCategories: string[] };
  raw?: R;
}): UtilizeReturnType<() => AiMapImportCategoriesResponse, R> {
  return makeRequest<AiMapImportCategoriesResponse, R>({
    method: 'post',
    url: '/import/ai-map-categories',
    payload,
    raw,
  });
}

// ============================================
// Extract Unique Values Endpoint
// ============================================

interface ExtractUniqueValuesParams {
  fileContent: string;
  delimiter: string;
  columnMapping: ColumnMappingConfig;
}

export function extractUniqueValues<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: ExtractUniqueValuesParams;
  raw?: R;
}): UtilizeReturnType<() => ExtractUniqueValuesResponse, R> {
  return makeRequest<ExtractUniqueValuesResponse, R>({
    method: 'post',
    url: '/import/csv/extract-unique-values',
    payload,
    raw,
  });
}

// ============================================
// Detect Duplicates Endpoint
// ============================================

interface DetectDuplicatesParams {
  fileContent: string;
  delimiter: string;
  columnMapping: ColumnMappingConfig;
  accountMapping: AccountMappingConfig;
  categoryMapping: CategoryMappingConfig;
  tagMapping?: TagMappingConfig;
  /** IANA timezone (e.g. `America/Montevideo`) used to anchor date-only cells. */
  timezone?: string;
}

export function detectDuplicates<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: DetectDuplicatesParams;
  raw?: R;
}): UtilizeReturnType<() => DetectDuplicatesResponse, R> {
  return makeRequest<DetectDuplicatesResponse, R>({
    method: 'post',
    url: '/import/csv/detect-duplicates',
    payload,
    raw,
  });
}

// ============================================
// Execute Import Endpoint
// ============================================

interface ExecuteImportParams {
  fileContent: string;
  delimiter: string;
  columnMapping: ColumnMappingConfig;
  accountMapping: AccountMappingConfig;
  categoryMapping: CategoryMappingConfig;
  tagMapping?: TagMappingConfig;
  skipDuplicateIndices: number[];
  skipUnpriceableIndices?: number[];
  defaultAccountId?: string;
  defaultCategoryId?: string;
  timezone?: string;
  recalculateBalance?: boolean;
}

/**
 * POST /import/csv/execute. The CSV execute step is asynchronous: this enqueues a
 * background job and resolves to `{ jobId }`. Callers poll the result via
 * {@link waitForCsvImportCompletion} (mirrors `executeBudgetBakersWallet` / `executeYnab`).
 */
export function executeImport<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: ExecuteImportParams;
  raw?: R;
}): UtilizeReturnType<() => ExecuteImportResponse, R> {
  return makeRequest<ExecuteImportResponse, R>({
    method: 'post',
    url: '/import/csv/execute',
    payload,
    raw,
  });
}

export function getCsvImportStatus<R extends boolean | undefined = false>({
  jobId,
  raw,
}: {
  jobId: string;
  raw?: R;
}): UtilizeReturnType<() => CsvImportProgress, R> {
  return makeRequest<CsvImportProgress, R>({
    method: 'get',
    url: `/import/csv/execute/status/${jobId}`,
    raw,
  });
}

/**
 * Poll GET /import/csv/execute/status/:jobId every 100 ms until the job leaves
 * the running/queued states or the timeout elapses. The BullMQ worker is async,
 * so the execute response only carries `jobId` — callers must poll for the
 * result. Mirrors `waitForBudgetBakersWalletCompletion`.
 */
export async function waitForCsvImportCompletion({
  jobId,
  timeoutMs = 30_000,
}: {
  jobId: string;
  timeoutMs?: number;
}): Promise<CsvImportProgress> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const progress = await getCsvImportStatus({ jobId, raw: true });
    if (progress.status === 'completed' || progress.status === 'failed') {
      return progress;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`CSV import job ${jobId} did not finish within ${timeoutMs}ms`);
}

/**
 * Narrow terminal CSV-import progress to the `completed` branch so tests can read
 * `summary` directly. Throws (failing the calling test) when the worker finished
 * with `status:'failed'`. Mirrors the Budget Bakers Wallet importer's `expectCompleted`.
 */
export function expectCsvImportCompleted(
  progress: CsvImportProgress,
): asserts progress is Extract<CsvImportProgress, { status: 'completed' }> {
  if (progress.status !== 'completed') {
    const detail = progress.status === 'failed' ? ` Error: ${progress.error}` : '';
    throw new Error(`Expected completed CSV import, got status="${progress.status}".${detail}`);
  }
}

/** Two-row CSV import. Source account "A" links to `accountId`, or is created when it is omitted. */
export async function runCsvImport({
  accountId,
  currencyCode,
  recalculateBalance = false,
  incomeAccountId,
  extraRows = [],
  timeoutMs,
  enteredBalance = null,
}: {
  accountId?: string;
  currencyCode: string;
  recalculateBalance?: boolean;
  /** Balance the user enters for "A" when the import creates it. */
  enteredBalance?: number | null;
  /** Adds a third income row on this account, giving the batch a row linkable
   *  to one of the expenses as a transfer pair. */
  incomeAccountId?: string;
  /** Extra CSV lines appended after the fixed rows, for oversized batches. */
  extraRows?: string[];
  timeoutMs?: number;
}) {
  const { jobId } = await executeImport({
    payload: {
      fileContent: [
        'Date,Amount,Description,Category,Account,Currency,Type',
        `2024-01-15,10.00,Coffee,,A,${currencyCode},expense`,
        `2024-01-16,20.00,Lunch,,A,${currencyCode},expense`,
        ...(incomeAccountId ? [`2024-01-17,20.00,Moved in,,B,${currencyCode},income`] : []),
        ...extraRows,
      ].join('\n'),
      delimiter: ',',
      columnMapping: {
        date: 'Date',
        dateFieldOrder: 'month-first',
        amount: 'Amount',
        description: 'Description',
        category: { option: CategoryOptionValue.mapDataSourceColumn, columnName: 'Category' },
        currency: { option: CurrencyOptionValue.dataSourceColumn, columnName: 'Currency' },
        transactionType: {
          option: TransactionTypeOptionValue.dataSourceColumn,
          columnName: 'Type',
          incomeValues: ['income'],
          expenseValues: ['expense'],
        },
        account: { option: AccountOptionValue.dataSourceColumn, columnName: 'Account' },
      },
      accountMapping: {
        A: accountId
          ? { action: 'link-existing', accountId }
          : { action: 'create-new', currentBalance: enteredBalance },
        ...(incomeAccountId ? { B: { action: 'link-existing', accountId: incomeAccountId } } : {}),
      },
      categoryMapping: {},
      skipDuplicateIndices: [],
      recalculateBalance,
    },
    raw: true,
  });
  const progress = await waitForCsvImportCompletion({ jobId, timeoutMs });
  expectCsvImportCompleted(progress);
  return progress.summary;
}

// ============================================
// Statement Parser - Estimate Cost Endpoint
// ============================================

/**
 * The route answers 200 with `{ success: false, error }` for a file it cannot read or one
 * too large for the model, so callers checking those shapes need `raw: false`.
 */
export function statementEstimateCost<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: { fileBase64: string; password?: string };
  raw?: R;
}): UtilizeReturnType<() => StatementCostEstimate, R> {
  return makeRequest<StatementCostEstimate, R>({
    method: 'post',
    url: '/import/text-source/estimate-cost',
    payload,
    raw,
  });
}

// ============================================
// Statement Parser - Extract Endpoint
// ============================================

/** Runs the real AI extraction, so callers must have an endpoint or key the mocks answer for. */
export function statementExtract<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: { fileBase64: string; password?: string };
  raw?: R;
}): UtilizeReturnType<() => StatementExtractionResult, R> {
  return makeRequest<StatementExtractionResult, R>({
    method: 'post',
    url: '/import/text-source/extract',
    payload,
    raw,
  });
}

// ============================================
// Statement Parser - Detect Duplicates Endpoint
// ============================================

interface StatementDetectDuplicatesParams {
  accountId: string;
  transactions: ExtractedTransaction[];
}

export function statementDetectDuplicates<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: StatementDetectDuplicatesParams;
  raw?: R;
}): UtilizeReturnType<() => StatementDetectDuplicatesResponse, R> {
  return makeRequest<StatementDetectDuplicatesResponse, R>({
    method: 'post',
    url: '/import/text-source/detect-duplicates',
    payload,
    raw,
  });
}

// ============================================
// Statement Parser - Execute Import Endpoint
// ============================================

interface StatementExecuteImportParams {
  accountId: string;
  transactions: ExtractedTransaction[];
  skipIndices: number[];
}

/**
 * POST /import/text-source/execute. The execute step is asynchronous: this
 * enqueues a background job and resolves to `{ jobId }`. Callers poll the result
 * via {@link waitForStatementImportCompletion}, or use
 * {@link statementExecuteImportAndWait} to do both in one call.
 */
export function statementExecuteImport<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: StatementExecuteImportParams;
  raw?: R;
}): UtilizeReturnType<() => StatementExecuteImportQueuedResponse, R> {
  return makeRequest<StatementExecuteImportQueuedResponse, R>({
    method: 'post',
    url: '/import/text-source/execute',
    payload,
    raw,
  });
}

export function getStatementImportStatus<R extends boolean | undefined = false>({
  jobId,
  raw,
}: {
  jobId: string;
  raw?: R;
}): UtilizeReturnType<() => StatementImportProgress, R> {
  return makeRequest<StatementImportProgress, R>({
    method: 'get',
    url: `/import/text-source/execute/status/${jobId}`,
    raw,
  });
}

/**
 * Poll GET /import/text-source/execute/status/:jobId every 100 ms until the job
 * leaves the running/queued states or the timeout elapses.
 */
export async function waitForStatementImportCompletion({
  jobId,
  timeoutMs = 30_000,
}: {
  jobId: string;
  timeoutMs?: number;
}): Promise<StatementImportProgress> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const progress = await getStatementImportStatus({ jobId, raw: true });
    if (progress.status === 'completed' || progress.status === 'failed') {
      return progress;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Statement import job ${jobId} did not finish within ${timeoutMs}ms`);
}

/**
 * Narrow terminal statement-import progress to the `completed` branch so tests
 * can read `summary` directly. Throws (failing the calling test) when the worker
 * finished with `status:'failed'`.
 */
export function expectStatementImportCompleted(
  progress: StatementImportProgress,
): asserts progress is Extract<StatementImportProgress, { status: 'completed' }> {
  if (progress.status !== 'completed') {
    const detail = progress.status === 'failed' ? ` Error: ${progress.error}` : '';
    throw new Error(`Expected completed statement import, got status="${progress.status}".${detail}`);
  }
}

/** Enqueue a statement import, wait for the worker, and return its summary. */
export async function statementExecuteImportAndWait({
  payload,
}: {
  payload: StatementExecuteImportParams;
}): Promise<StatementImportSummary> {
  const { jobId } = await statementExecuteImport({ payload, raw: true });
  const progress = await waitForStatementImportCompletion({ jobId });
  expectStatementImportCompleted(progress);
  return progress.summary;
}

// ============================================
// YNAB Import - Parse Endpoint
// ============================================

interface ParseYnabParams {
  fileContent: string;
}

export function parseYnab<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: ParseYnabParams;
  raw?: R;
}): UtilizeReturnType<() => ParseYnabResponse, R> {
  return makeRequest<ParseYnabResponse, R>({
    method: 'post',
    url: '/import/ynab/parse',
    payload,
    raw,
  });
}

// ============================================
// YNAB Import - Execute Endpoint
// ============================================

interface ExecuteYnabParams {
  fileContent: string;
  accountMapping: YnabAccountMapping;
}

export function executeYnab<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: ExecuteYnabParams;
  raw?: R;
}): UtilizeReturnType<() => ExecuteYnabResponse, R> {
  return makeRequest<ExecuteYnabResponse, R>({
    method: 'post',
    url: '/import/ynab/execute',
    payload,
    raw,
  });
}

// ============================================
// YNAB Import - Status Endpoint
// ============================================

export function getYnabImportStatus<R extends boolean | undefined = false>({
  jobId,
  raw,
}: {
  jobId: string;
  raw?: R;
}): UtilizeReturnType<() => YnabImportProgress, R> {
  return makeRequest<YnabImportProgress, R>({
    method: 'get',
    url: `/import/ynab/status/${jobId}`,
    raw,
  });
}

/**
 * Poll GET /import/ynab/status/:jobId every 100 ms until the job leaves the
 * running/queued states or the timeout elapses. The BullMQ worker is async, so
 * the execute response only carries `jobId` — callers must poll for the result.
 * Mirrors `waitForCsvImportCompletion` / `waitForBudgetBakersWalletCompletion`.
 */
export async function waitForYnabImportCompletion({
  jobId,
  timeoutMs = 30_000,
}: {
  jobId: string;
  timeoutMs?: number;
}): Promise<YnabImportProgress> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const progress = await getYnabImportStatus({ jobId, raw: true });
    if (progress.status === 'completed' || progress.status === 'failed') {
      return progress;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`YNAB import job ${jobId} did not finish within ${timeoutMs}ms`);
}

/**
 * Narrow terminal YNAB progress to the `completed` branch so tests can read
 * `summary` directly. Throws (failing the calling test) when the worker
 * finished with `status:'failed'`. Mirrors `expectCsvImportCompleted`.
 */
export function expectYnabImportCompleted(
  progress: YnabImportProgress,
): asserts progress is Extract<YnabImportProgress, { status: 'completed' }> {
  if (progress.status !== 'completed') {
    throw new Error(`Expected completed YNAB import, got status="${progress.status}".`);
  }
}

/** Imports `register-basic.csv`, creating every account it names in its detected currency. */
export async function runYnabImport() {
  const fileContent = loadYnabFixture('register-basic.csv');
  const parsed = await parseYnab({ payload: { fileContent }, raw: true });
  const accountNames = parsed.result.accounts.map((a) => a.originalName);
  const accountMapping = Object.fromEntries(
    parsed.result.accounts.map((a) => [a.originalName, { currencyCode: a.detectedCurrency! }]),
  );
  const { jobId } = await executeYnab({ payload: { fileContent, accountMapping }, raw: true });
  const progress = await waitForYnabImportCompletion({ jobId });
  expectYnabImportCompleted(progress);
  return { summary: progress.summary, accountNames };
}

// ============================================
// Budget Bakers Wallet Import - Fixture Loader
// ============================================

/** Load a Wallet (BudgetBakers) CSV fixture by filename. */
export function loadBudgetBakersWalletFixture(filename: string): string {
  const filePath = path.join(BUDGET_BAKERS_WALLET_FIXTURES_PATH, filename);
  return fs.readFileSync(filePath, 'utf-8');
}

// ============================================
// Budget Bakers Wallet Import - Parse Endpoint
// ============================================

interface ParseBudgetBakersWalletParams {
  fileContent: string;
}

export function parseBudgetBakersWallet<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: ParseBudgetBakersWalletParams;
  raw?: R;
}): UtilizeReturnType<() => ParseBudgetBakersWalletResponse, R> {
  return makeRequest<ParseBudgetBakersWalletResponse, R>({
    method: 'post',
    url: '/import/budget-bakers-wallet/parse',
    payload,
    raw,
  });
}

// ============================================
// Budget Bakers Wallet Import - Detect Duplicates Endpoint
// ============================================

interface DetectBudgetBakersWalletDuplicatesParams {
  fileContent: string;
  accountMapping: BudgetBakersWalletAccountMapping;
}

export function detectBudgetBakersWalletDuplicates<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: DetectBudgetBakersWalletDuplicatesParams;
  raw?: R;
}): UtilizeReturnType<() => DetectBudgetBakersWalletDuplicatesResponse, R> {
  return makeRequest<DetectBudgetBakersWalletDuplicatesResponse, R>({
    method: 'post',
    url: '/import/budget-bakers-wallet/detect-duplicates',
    payload,
    raw,
  });
}

// ============================================
// Budget Bakers Wallet Import - Execute Endpoint
// ============================================

interface ExecuteBudgetBakersWalletParams {
  fileContent: string;
  accountMapping: BudgetBakersWalletAccountMapping;
  /** Per-category decision keyed by the verbatim Wallet `category` value.
   *  Defaults to `{}` so existing callers that omit it still satisfy the
   *  backend's required field — an empty record is valid (all parsed categories
   *  import without a category rather than being silently created). */
  categoryMapping?: CategoryMappingConfig;
  skipDuplicateIndices?: number[];
  recalculateBalance?: boolean;
}

export function executeBudgetBakersWallet<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: ExecuteBudgetBakersWalletParams;
  raw?: R;
}): UtilizeReturnType<() => ExecuteBudgetBakersWalletResponse, R> {
  // `?? []` / `?? {}` guard against a caller passing the field as `undefined`,
  // which would otherwise overwrite the safe default and fail Zod validation.
  const { skipDuplicateIndices, categoryMapping, ...rest } = payload;
  return makeRequest<ExecuteBudgetBakersWalletResponse, R>({
    method: 'post',
    url: '/import/budget-bakers-wallet/execute',
    payload: {
      ...rest,
      skipDuplicateIndices: skipDuplicateIndices ?? [],
      categoryMapping: categoryMapping ?? {},
    },
    raw,
  });
}

// ============================================
// Budget Bakers Wallet Import - Status Endpoint
// ============================================

export function getBudgetBakersWalletImportStatus<R extends boolean | undefined = false>({
  jobId,
  raw,
}: {
  jobId: string;
  raw?: R;
}): UtilizeReturnType<() => BudgetBakersWalletImportProgress, R> {
  return makeRequest<BudgetBakersWalletImportProgress, R>({
    method: 'get',
    url: `/import/budget-bakers-wallet/status/${jobId}`,
    raw,
  });
}

// ============================================
// Budget Bakers Wallet Import - Shared polling helper
// ============================================

/**
 * Poll GET /import/budget-bakers-wallet/status/:jobId every 100 ms until the job
 * leaves the running/queued states or the timeout elapses. The BullMQ worker is
 * async, so the execute response only carries `jobId` — callers must poll for the
 * result.
 *
 * A single shared implementation avoids divergent timeouts across test files
 * (detect-duplicates and execute-import both need it).
 */
export async function waitForBudgetBakersWalletCompletion({
  jobId,
  timeoutMs = 30_000,
}: {
  jobId: string;
  timeoutMs?: number;
}): Promise<BudgetBakersWalletImportProgress> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const progress = await getBudgetBakersWalletImportStatus({ jobId, raw: true });
    if (progress.status === 'completed' || progress.status === 'failed') {
      return progress;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Budget Bakers Wallet import job ${jobId} did not finish within ${timeoutMs}ms`);
}

/**
 * Narrow terminal progress to the `completed` branch so tests can read `summary`
 * directly without an extra type guard. Throws (failing the calling test) when
 * the worker finished with `status:'failed'`, surfacing the error string for
 * quick debugging. Shared so detect-duplicates and execute-import tests assert
 * completion identically.
 */
export function expectCompleted(
  progress: BudgetBakersWalletImportProgress,
): asserts progress is Extract<BudgetBakersWalletImportProgress, { status: 'completed' }> {
  if (progress.status !== 'completed') {
    const detail = progress.status === 'failed' ? ` Error: ${progress.error}` : '';
    throw new Error(`Expected completed import, got status="${progress.status}".${detail}`);
  }
}

// ============================================
// OFX Import
// ============================================

export interface UploadOfxResult {
  statusCode: number;
  response: OfxUploadResponse | null;
  errorMessage: string | null;
}

/** POST raw OFX/QFX bytes through the authenticated HTTP endpoint. */
export async function uploadOfx({
  file,
  contentType = 'application/octet-stream',
}: {
  file: Buffer;
  contentType?: string;
}): Promise<UploadOfxResult> {
  const base = request(app).post(`${API_PREFIX}/import/ofx/upload`).set('Content-Type', contentType);
  if (global.APP_AUTH_COOKIES) base.set('Cookie', global.APP_AUTH_COOKIES);
  const result = await base.send(file);
  const body = result.body as { response?: OfxUploadResponse & { message?: string } };
  return {
    statusCode: result.status,
    response: result.status === 200 ? (body.response ?? null) : null,
    errorMessage: result.status === 200 ? null : (body.response?.message ?? null),
  };
}

export async function uploadOfxFixture({ filename }: { filename: string }): Promise<OfxUploadResponse> {
  const result = await uploadOfx({ file: loadOfxFixture({ filename }) });
  if (!result.response) {
    throw new Error(`Upload of ${filename} failed with ${result.statusCode}: ${result.errorMessage}`);
  }
  return result.response;
}

export function detectOfxDuplicates<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: { uploadId: string; accountMapping: OfxAccountMapping };
  raw?: R;
}): UtilizeReturnType<() => DetectOfxDuplicatesResponse, R> {
  return makeRequest<DetectOfxDuplicatesResponse, R>({
    method: 'post',
    url: '/import/ofx/detect-duplicates',
    payload,
    raw,
  });
}

export function executeOfx<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: Omit<ExecuteOfxRequest, 'skipDuplicateIndices'> & { skipDuplicateIndices?: number[] };
  raw?: R;
}): UtilizeReturnType<() => ExecuteOfxResponse, R> {
  return makeRequest<ExecuteOfxResponse, R>({
    method: 'post',
    url: '/import/ofx/execute',
    payload: { ...payload, skipDuplicateIndices: payload.skipDuplicateIndices ?? [] },
    raw,
  });
}

export function getOfxImportStatus<R extends boolean | undefined = false>({
  jobId,
  raw,
}: {
  jobId: string;
  raw?: R;
}): UtilizeReturnType<() => OfxImportProgress, R> {
  return makeRequest<OfxImportProgress, R>({ method: 'get', url: `/import/ofx/status/${jobId}`, raw });
}

export async function waitForOfxImportCompletion({
  jobId,
  timeoutMs = 30_000,
}: {
  jobId: string;
  timeoutMs?: number;
}): Promise<OfxImportProgress> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const progress = await getOfxImportStatus({ jobId, raw: true });
    if (progress.status === 'completed' || progress.status === 'failed') return progress;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`OFX import job ${jobId} did not finish within ${timeoutMs}ms`);
}

export function expectOfxCompleted(
  progress: OfxImportProgress,
): asserts progress is Extract<OfxImportProgress, { status: 'completed' }> {
  if (progress.status !== 'completed') {
    const detail = progress.status === 'failed' ? ` Error: ${progress.error}` : '';
    throw new Error(`Expected completed OFX import, got status="${progress.status}".${detail}`);
  }
}

// ============================================
// Microsoft Money Import - Upload Endpoint
// ============================================

export interface UploadMsMoneyResult {
  statusCode: number;
  /** Present on success. */
  response: MsMoneyUploadResponse | null;
  /** Error message from the API envelope, when the request failed. */
  errorMessage: string | null;
}

/**
 * POST /import/ms-money/upload. Bypasses `makeRequest` because the body is the
 * file's raw bytes rather than JSON, and the password rides on a header.
 * Uses the ambient auth cookies, so it composes with `asUser`.
 */
export async function uploadMsMoney({
  file,
  password,
  contentType = 'application/octet-stream',
}: {
  file: Buffer;
  password?: string;
  contentType?: string;
}): Promise<UploadMsMoneyResult> {
  const base = request(app).post(`${API_PREFIX}/import/ms-money/upload`).set('Content-Type', contentType);
  if (global.APP_AUTH_COOKIES) base.set('Cookie', global.APP_AUTH_COOKIES);
  if (password !== undefined) base.set('x-file-password', password);

  const result = await base.send(file);
  const body = result.body as { response?: MsMoneyUploadResponse & { message?: string } };

  return {
    statusCode: result.status,
    response: result.status === 200 ? ((body.response ?? null) as MsMoneyUploadResponse | null) : null,
    errorMessage: result.status === 200 ? null : (body.response?.message ?? null),
  };
}

/**
 * Upload a `.mny` fixture and fail loudly when it does not parse — the mapping
 * steps need the `uploadId`, and a silent null there surfaces as a confusing 404
 * later.
 */
export async function uploadMsMoneyFixture({
  file,
  password,
}: {
  file: string;
  password?: string;
}): Promise<MsMoneyUploadResponse> {
  const result = await uploadMsMoney({ file: readMsMoneyFixture({ file }), password });
  if (!result.response) {
    throw new Error(`Upload of ${file} failed with ${result.statusCode}: ${result.errorMessage}`);
  }
  return result.response;
}

// ============================================
// Microsoft Money Import - Detect Duplicates Endpoint
// ============================================

interface DetectMsMoneyDuplicatesParams {
  uploadId: string;
  accountMapping: MsMoneyAccountMapping;
}

export function detectMsMoneyDuplicates<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: DetectMsMoneyDuplicatesParams;
  raw?: R;
}): UtilizeReturnType<() => DetectMsMoneyDuplicatesResponse, R> {
  return makeRequest<DetectMsMoneyDuplicatesResponse, R>({
    method: 'post',
    url: '/import/ms-money/detect-duplicates',
    payload,
    raw,
  });
}

// ============================================
// Microsoft Money Import - Execute Endpoint
// ============================================

interface ExecuteMsMoneyParams {
  uploadId: string;
  accountMapping: MsMoneyAccountMapping;
  /** Per-category decision keyed by the parser's `fullName` ("Bills:Water").
   *  Defaults to `{}` — every parsed category then imports without a category. */
  categoryMapping?: CategoryMappingConfig;
  skipDuplicateIndices?: number[];
  includeVoidedTransactions?: boolean;
  recalculateBalance?: boolean;
}

export function executeMsMoney<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: ExecuteMsMoneyParams;
  raw?: R;
}): UtilizeReturnType<() => ExecuteMsMoneyResponse, R> {
  // `?? []` / `?? {}` guard against a caller passing the field as `undefined`,
  // which would otherwise overwrite the safe default and fail Zod validation.
  const { skipDuplicateIndices, categoryMapping, ...rest } = payload;
  return makeRequest<ExecuteMsMoneyResponse, R>({
    method: 'post',
    url: '/import/ms-money/execute',
    payload: {
      ...rest,
      skipDuplicateIndices: skipDuplicateIndices ?? [],
      categoryMapping: categoryMapping ?? {},
    },
    raw,
  });
}

// ============================================
// Microsoft Money Import - Status Endpoint
// ============================================

export function getMsMoneyImportStatus<R extends boolean | undefined = false>({
  jobId,
  raw,
}: {
  jobId: string;
  raw?: R;
}): UtilizeReturnType<() => MsMoneyImportProgress, R> {
  return makeRequest<MsMoneyImportProgress, R>({
    method: 'get',
    url: `/import/ms-money/status/${jobId}`,
    raw,
  });
}

/**
 * Poll GET /import/ms-money/status/:jobId every 100 ms until the job leaves the
 * running/queued states or the timeout elapses. The BullMQ worker is async, so
 * the execute response only carries `jobId` — callers must poll for the result.
 */
export async function waitForMsMoneyCompletion({
  jobId,
  timeoutMs = 60_000,
}: {
  jobId: string;
  timeoutMs?: number;
}): Promise<MsMoneyImportProgress> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const progress = await getMsMoneyImportStatus({ jobId, raw: true });
    if (progress.status === 'completed' || progress.status === 'failed') {
      return progress;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Microsoft Money import job ${jobId} did not finish within ${timeoutMs}ms`);
}

/**
 * Narrow terminal progress to the `completed` branch so tests can read `summary`
 * directly. Throws (failing the calling test) when the worker finished with
 * `status:'failed'`, surfacing the error string for quick debugging.
 */
export function expectMsMoneyCompleted(
  progress: MsMoneyImportProgress,
): asserts progress is Extract<MsMoneyImportProgress, { status: 'completed' }> {
  if (progress.status !== 'completed') {
    const detail = progress.status === 'failed' ? ` Error: ${progress.error}` : '';
    throw new Error(`Expected completed Microsoft Money import, got status="${progress.status}".${detail}`);
  }
}

/**
 * The mirror of {@link expectMsMoneyCompleted} for the refusal cases: narrows to
 * the `failed` branch so tests can read `error` directly, and fails the calling
 * test when the worker finished any other way.
 */
export function expectMsMoneyFailed(
  progress: MsMoneyImportProgress,
): asserts progress is Extract<MsMoneyImportProgress, { status: 'failed' }> {
  if (progress.status !== 'failed') {
    throw new Error(`Expected failed Microsoft Money import, got status="${progress.status}".`);
  }
}

// ============================================
// Import Batches History Endpoint
// ============================================

export function getBatchesHistory<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload?: { limit?: number; offset?: number };
  raw?: R;
} = {}): UtilizeReturnType<() => ImportBatchesHistoryResponse, R> {
  return makeRequest<ImportBatchesHistoryResponse, R>({
    method: 'get',
    url: '/import/batches-history',
    payload,
    raw,
  });
}

// ============================================
// Delete Import Batch Endpoint
// ============================================

export function getImportBatchDeleteStatus<R extends boolean | undefined = false>({
  raw,
}: { raw?: R } = {}): UtilizeReturnType<() => ImportBatchDeleteActiveStatus, R> {
  return makeRequest<ImportBatchDeleteActiveStatus, R>({
    method: 'get',
    url: '/import/batch-delete/status',
    raw,
  });
}

/** Poll GET /import/batch-delete/status every 100 ms until the job settles. */
export async function waitForImportBatchDelete({
  timeoutMs = 60_000,
}: { timeoutMs?: number } = {}): Promise<ImportBatchDeleteActiveStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getImportBatchDeleteStatus({ raw: true });
    if (status.state === 'completed' || status.state === 'failed') return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Import batch delete did not finish within ${timeoutMs}ms`);
}

export function deleteImportBatch<R extends boolean | undefined = false>({
  batchId,
  deleteLinkedTransfers,
  raw,
}: {
  batchId: string;
  deleteLinkedTransfers?: boolean;
  raw?: R;
}): UtilizeReturnType<() => DeleteImportBatchResponse, R> {
  return makeRequest<DeleteImportBatchResponse, R>({
    method: 'delete',
    url: `/import/batch/${batchId}`,
    payload: deleteLinkedTransfers !== undefined ? { deleteLinkedTransfers } : undefined,
    raw,
  });
}

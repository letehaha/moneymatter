import type { ResourceLease } from '../resource-lease';
import { TRANSACTION_TYPES } from '../transactions';
import { IMPORT_JOB_STATUSES } from './core';
import type { DuplicateMatch, ImportError, ImportExecuteRequestBase, ImportJobStatus, ImportSummaryBase } from './core';

export const OFX_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const OFX_MAX_ROWS = 100_000;
export const OFX_UPLOAD_IDLE_TTL_MS = 30 * 60 * 1000;
export const OFX_UPLOAD_MAX_LIFETIME_MS = 4 * 60 * 60 * 1000;

export type OfxStatementType = 'bank' | 'credit-card';

export interface OfxParseAccount {
  sourceAccountKey: string;
  maskedDisplayName: string;
  suggestedLocalName: string;
  statementType: OfxStatementType;
  accountType: string;
  currency: string;
  transactionCount: number;
  /** Exact signed decimal text from the source rows. */
  netImportedAmount: string;
  /** Exact signed decimal text from LEDGERBAL. */
  ledgerBalance?: string;
  ledgerBalanceDate?: string;
}

export interface OfxParseTransaction {
  rowIndex: number;
  sourceTransactionKey?: string;
  sourceAccountKey: string;
  date: string;
  /** Exact signed decimal text. The backend converts it to Money only at use sites. */
  amount: string;
  type: TRANSACTION_TYPES;
  payeeName: string | null;
  note: string;
  transactionType: string;
  checkNumber?: string;
  referenceNumber?: string;
}

export interface OfxParseWarning {
  code: 'date-user-fallback' | 'fitid-missing' | 'fitid-duplicate';
  message: string;
  count: number;
}

export interface OfxParseResult {
  accounts: OfxParseAccount[];
  transactions: OfxParseTransaction[];
  warnings: OfxParseWarning[];
  dateRange: { from: string; to: string } | null;
  formatVersion: string;
  financialInstitutionName: string | null;
}

export type OfxAccountMappingValue =
  | { action: 'create-new'; name: string; currencyCode: string; currentBalance: number | null }
  | { action: 'link-existing'; accountId: string }
  | { action: 'skip' };

export type OfxAccountMapping = Record<string, OfxAccountMappingValue>;

export interface OfxUploadResponse {
  uploadId: string;
  result: OfxParseResult;
  lease: ResourceLease;
}

export interface DetectOfxDuplicatesRequest {
  uploadId: string;
  accountMapping: OfxAccountMapping;
}

export interface DetectOfxDuplicatesResponse {
  duplicates: DuplicateMatch[];
}

export interface ExecuteOfxRequest extends ImportExecuteRequestBase {
  uploadId: string;
  accountMapping: OfxAccountMapping;
  skipDuplicateIndices: number[];
}

export interface ExecuteOfxResponse {
  jobId: string;
}

export const OFX_IMPORT_JOB_STATUSES = IMPORT_JOB_STATUSES;
export type OfxImportJobStatus = ImportJobStatus;

export interface OfxImportSummary extends ImportSummaryBase {
  batchId: string;
  newTransactionIds: string[];
  accountsCreated: number;
  accountsLinked: number;
  accountsSkipped: number;
  payeesCreated: number;
  transactionsImported: number;
  duplicatesSkipped: number;
  merged: number;
  errors: ImportError[];
}

interface OfxImportProgressBase {
  jobId: string;
  processedCount: number;
  totalCount: number;
}

export type OfxImportProgress =
  | (OfxImportProgressBase & { status: 'queued' | 'running' })
  | (OfxImportProgressBase & { status: 'completed'; summary: OfxImportSummary })
  | (OfxImportProgressBase & { status: 'failed'; error: string });

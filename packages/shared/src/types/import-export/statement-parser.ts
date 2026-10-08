/**
 * Statement Parser types
 * Types for AI-powered bank statement extraction from PDF, CSV, TXT files
 */
import type { Decimal } from '../money';

/**
 * Supported file types for statement parsing
 */
export type StatementFileType = 'pdf' | 'csv' | 'txt';

/**
 * Why text extraction produced nothing usable. The UI branches on this: a
 * protected PDF needs a password prompt, a scanned one needs a different file.
 */
export type StatementTextExtractionErrorCode =
  | 'PASSWORD_REQUIRED'
  | 'PASSWORD_INVALID'
  | 'NO_TEXT_CONTENT'
  | 'PARSE_FAILED';

/**
 * `textExtraction` block of the estimate response when no text could be read.
 */
export interface StatementTextExtractionFailure {
  success: false;
  /** Characters that were extracted before the attempt was judged a failure */
  characterCount: number;
  /** Number of pages (for PDF) or 1 */
  pageCount: number;
  /** Raw parser message, for diagnostics */
  error?: string;
  errorCode?: StatementTextExtractionErrorCode;
}

/**
 * `textExtraction` block of the estimate response when the text was read fine.
 */
export interface StatementTextExtractionSuccess {
  success: true;
  /** Extracted text character count */
  characterCount: number;
  /** Number of pages (for PDF) or 1 */
  pageCount: number;
}

/**
 * Single extracted transaction from statement
 */
export interface ExtractedTransaction {
  /** Transaction date in YYYY-MM-DD or YYYY-MM-DD HH:MM:SS format */
  date: string;
  /** Original description from statement */
  description: string;
  /** Merchant / counterparty name when the AI could separate it from the
   *  description. When present, this drives Payee linking + payee_rule
   *  auto-categorization the same way bank-sync providers' merchant fields do. */
  merchant?: string;
  /** Transaction amount (always positive) */
  amount: number;
  /** Transaction type: income or expense */
  type: 'income' | 'expense';
  /** Running balance after transaction (if available) */
  balance?: number;
  /** Extraction confidence score 0.0-1.0 (optional, only from AI extraction) */
  confidence?: number;
}

/**
 * Metadata extracted from statement
 */
export interface ExtractedMetadata {
  /** Bank name if identified */
  bankName?: string;
  /** Last 4 digits of account number if found */
  accountNumberLast4?: string;
  /** Statement period */
  statementPeriod?: {
    from: string;
    to: string;
  };
  /** Detected currency code (e.g., 'USD', 'EUR') */
  currencyCode?: string;
}

/**
 * Result of AI extraction from statement file
 */
export interface StatementExtractionResult {
  /** Extracted transactions */
  transactions: ExtractedTransaction[];
  /** Extracted metadata */
  metadata: ExtractedMetadata;
  /** Total pages (for PDF) or 1 for text files */
  pageCount: number;
  /** Detected file type */
  fileType: StatementFileType;
  /** Approximate token count for cost display */
  tokenCount: {
    input: number;
    output: number;
  };
  /** Lines the model emitted that no transaction could be read from. */
  droppedRowCount: number;
}

/**
 * Cost estimate before processing
 */
export interface StatementCostEstimate {
  /** Estimated input tokens */
  estimatedInputTokens: number;
  /** Estimated output tokens (based on expected transactions) */
  estimatedOutputTokens: number;
  /**
   * Estimated cost in USD. Null when the public model catalog has no price for the model or
   * can't be reached. A free model is a known price of 0.
   */
  estimatedCostUsd: number | null;
  /** Model that will be used */
  modelId: string;
  /** Model display name */
  modelName: string;
  /** Whether using user's API key */
  usingUserKey: boolean;
  /** Text extraction details */
  textExtraction: {
    /** Whether text extraction was successful */
    success: boolean;
    /** Extracted text character count */
    characterCount: number;
    /** Number of pages (for PDF) or 1 */
    pageCount: number;
  };
  /** Detected file type */
  fileType: StatementFileType;
}

/**
 * What the estimate endpoint answers 200 with when it produced no estimate.
 * `textExtraction` may still report success: a file whose text was read fine can
 * still be too large for the model's context window.
 */
export interface StatementCostEstimateFailure {
  success: false;
  textExtraction: StatementTextExtractionFailure | StatementTextExtractionSuccess;
  fileType: StatementFileType;
  suggestion: string;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

/**
 * Request for statement extraction
 */
export interface StatementExtractRequest {
  /** Base64 encoded file content */
  fileBase64: string;
  /** Document password, for encrypted PDFs */
  password?: string;
}

/**
 * Error response for statement extraction
 */
export interface StatementExtractError {
  /** Error code for frontend handling */
  code:
    | 'NO_AI_CONFIGURED'
    | 'INVALID_FILE'
    | 'FILE_TOO_LARGE'
    | 'EXTRACTION_FAILED'
    | 'NO_TRANSACTIONS_FOUND'
    | 'AI_ERROR'
    | 'RATE_LIMITED'
    | 'TOKEN_LIMIT_EXCEEDED'
    /** The model's reply was cut off at its output limit, so the rows are incomplete. */
    | 'OUTPUT_TRUNCATED';
  /** Human-readable error message */
  message: string;
  /** Additional details */
  details?: string;
}

/**
 * Request for statement duplicate detection
 */
export interface StatementDetectDuplicatesRequest {
  /** Account ID to check duplicates against */
  accountId: string;
  /** Extracted transactions from AI */
  transactions: ExtractedTransaction[];
}

/**
 * Duplicate match for statement import
 * Simpler than CSV import since we match by date + amount + type only
 */
export interface StatementDuplicateMatch {
  /** Index in the extracted transactions array */
  transactionIndex: number;
  /** The extracted transaction */
  extractedTransaction: ExtractedTransaction;
  /** The existing transaction in the database */
  existingTransaction: {
    id: string;
    date: string;
    amount: Decimal;
    note: string;
  };
}

/**
 * Response from statement duplicate detection
 */
export interface StatementDetectDuplicatesResponse {
  /** Indices of transactions that appear to be duplicates */
  duplicates: StatementDuplicateMatch[];
}

/**
 * Request for statement import execution
 */
export interface StatementExecuteImportRequest {
  /** Account ID to import transactions to */
  accountId: string;
  /** Extracted transactions to import */
  transactions: ExtractedTransaction[];
  /** Transaction indices to skip (confirmed duplicates) */
  skipIndices: number[];
}

/**
 * Import error for a specific transaction
 */
export interface StatementImportError {
  transactionIndex: number;
  error: string;
}

/**
 * Response of POST /import/text-source/execute. The import runs as a background
 * job; the client follows it over SSE (`STATEMENT_IMPORT_PROGRESS`) and/or by
 * polling GET /import/text-source/execute/status/:jobId.
 */
export interface StatementExecuteImportQueuedResponse {
  jobId: string;
}

/**
 * What the statement import worker reports once it finishes. Carried in the
 * `completed` SSE event and the status endpoint's `completed` payload, so
 * `newTransactionIds`/`batchId` survive to the client without a separate fetch.
 */
export interface StatementImportSummary {
  imported: number;
  /**
   * Rows that merged into an existing planned transaction instead of creating a
   * new one. Counted here instead of `imported`, and absent from
   * `newTransactionIds`.
   */
  merged?: number;
  skipped: number;
  errors: StatementImportError[];
  newTransactionIds: string[];
  batchId: string;
}

/** Common counters every statement import progress event carries. */
interface StatementImportProgressBase {
  jobId: string;
  processedCount: number;
  totalCount: number;
}

/**
 * SSE payload and GET /status response share the same envelope. Discriminated
 * over `status` so `summary` is guaranteed when completed and `error` is
 * guaranteed when failed.
 */
export type StatementImportProgress =
  | (StatementImportProgressBase & { status: 'queued' | 'running' })
  | (StatementImportProgressBase & { status: 'completed'; summary: StatementImportSummary })
  | (StatementImportProgressBase & { status: 'failed'; error: string });

// Re-export old names for backward compatibility during migration
// TODO: Remove these after full migration
/** @deprecated Use StatementExtractionResult instead */
export type PDFExtractionResult = StatementExtractionResult;
/** @deprecated Use StatementCostEstimate instead */
export type PDFCostEstimate = StatementCostEstimate;
/** @deprecated Use StatementExtractRequest instead */
export type PDFExtractRequest = StatementExtractRequest;
/** @deprecated Use StatementExtractError instead */
export type PDFExtractError = StatementExtractError;

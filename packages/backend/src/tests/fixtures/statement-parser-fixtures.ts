/**
 * Small PDFs the statement-parser tests read from disk.
 *
 * They are committed because they weigh ~1KB each and the cases they cover
 * (an encrypted document, a page with no text layer) cannot be faked with a
 * mocked pdf.js — the classification being tested is pdf.js's own.
 */
import fs from 'node:fs';
import path from 'node:path';

const STATEMENT_PARSER_FIXTURES_DIR = path.resolve(__dirname, 'statement-parser');

/** The password the encrypted fixture was written with — test data, not a credential. */
export const ENCRYPTED_STATEMENT_PASSWORD = 'statement-pass-2024';

/** Text present in the encrypted fixture once it is unlocked. */
export const ENCRYPTED_STATEMENT_MERCHANT = 'LIDL STOCKHOLM';

export const STATEMENT_PDF_FIXTURES = {
  /** RC4-128 encrypted with `ENCRYPTED_STATEMENT_PASSWORD`. */
  encrypted: 'password-protected-statement.pdf',
  /** Single blank page: stands in for a scan that carries no text layer. */
  noTextLayer: 'no-text-layer-statement.pdf',
} as const;

/** Smallest valid 1x1 PNG. */
export const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const readStatementPdfFixture = ({ file }: { file: string }): Buffer =>
  fs.readFileSync(path.join(STATEMENT_PARSER_FIXTURES_DIR, file));

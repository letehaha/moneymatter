import type { StatementImportError, StatementImportErrorCode } from '@bt/shared/types';

type Translate = (key: string, named: Record<string, unknown>) => string;

const PREFIX = 'pages.statementParser.importResults.rowErrors';

const KEY_BY_CODE: Record<StatementImportErrorCode, string> = {
  INVALID_DATE: 'invalidDate',
  FUTURE_DATE: 'futureDate',
  AMOUNT_NOT_POSITIVE: 'amountNotPositive',
  AMOUNT_TOO_LARGE: 'amountTooLarge',
  ROW_FAILED: 'rowFailed',
};

/** An unknown code reads as the generic row failure rather than an empty cell. */
export function formatStatementImportRowError({ error, t }: { error: StatementImportError; t: Translate }): string {
  return t(`${PREFIX}.${KEY_BY_CODE[error.code] ?? KEY_BY_CODE.ROW_FAILED}`, { ...error.params });
}

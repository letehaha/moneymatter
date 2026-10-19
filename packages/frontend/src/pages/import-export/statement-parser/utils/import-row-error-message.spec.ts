import type { StatementImportError } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { formatStatementImportRowError } from './import-row-error-message';

const t = (key: string, named: Record<string, unknown>) =>
  Object.keys(named).length ? `${key} ${JSON.stringify(named)}` : key;

describe('formatStatementImportRowError', () => {
  it('keys the copy by code and passes the params through', () => {
    expect(
      formatStatementImportRowError({
        error: { transactionIndex: 3, code: 'AMOUNT_TOO_LARGE', params: { amount: 2_000_000_000, max: 1_000_000_000 } },
        t,
      }),
    ).toBe('pages.statementParser.importResults.rowErrors.amountTooLarge {"amount":2000000000,"max":1000000000}');
    expect(formatStatementImportRowError({ error: { transactionIndex: 0, code: 'ROW_FAILED' }, t })).toBe(
      'pages.statementParser.importResults.rowErrors.rowFailed',
    );
  });

  it('falls back to the generic row failure for a code this client does not know', () => {
    const error = { transactionIndex: 1, code: 'SOMETHING_NEW' } as unknown as StatementImportError;

    expect(formatStatementImportRowError({ error, t })).toBe('pages.statementParser.importResults.rowErrors.rowFailed');
  });
});

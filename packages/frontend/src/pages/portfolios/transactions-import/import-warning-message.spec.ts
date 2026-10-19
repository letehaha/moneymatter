import type { InvestmentImportWarning } from '@bt/shared/types/investments';
import { describe, expect, it } from 'vitest';

import { formatInvestmentImportWarning } from './import-warning-message';

const t = (key: string, named: Record<string, unknown>) =>
  Object.keys(named).length ? `${key} ${JSON.stringify(named)}` : key;

describe('formatInvestmentImportWarning', () => {
  it('keys the copy by code and passes the params through', () => {
    expect(
      formatInvestmentImportWarning({
        warning: { code: 'CSV_ROW_INVALID_DATE', params: { row: 3, value: 'not-a-date' } },
        t,
      }),
    ).toBe('investmentsImport.warnings.csvRowInvalidDate {"row":3,"value":"not-a-date"}');
    expect(formatInvestmentImportWarning({ warning: { code: 'DUPLICATE_CHECK_FAILED' }, t })).toBe(
      'investmentsImport.warnings.duplicateCheckFailed',
    );
  });

  it('translates the side param through the category labels', () => {
    expect(
      formatInvestmentImportWarning({
        warning: { code: 'UNSUPPORTED_CATEGORY', params: { symbol: 'AAPL', side: 'fee', date: '2026-01-02' } },
        t,
      }),
    ).toBe(
      'investmentsImport.warnings.unsupportedCategory {"symbol":"AAPL","side":"investmentsImport.categories.fee","date":"2026-01-02"}',
    );
  });

  it('uses the with-reason variant only when the server sent a reason', () => {
    expect(
      formatInvestmentImportWarning({
        warning: { code: 'HOLDING_SETUP_FAILED', params: { symbol: 'BTC', reason: 'Знайдіть цінний папір знову' } },
        t,
      }),
    ).toBe(
      'investmentsImport.warnings.holdingSetupFailedWithReason {"symbol":"BTC","reason":"Знайдіть цінний папір знову"}',
    );
    expect(
      formatInvestmentImportWarning({ warning: { code: 'HOLDING_SETUP_FAILED', params: { symbol: 'BTC' } }, t }),
    ).toBe('investmentsImport.warnings.holdingSetupFailed {"symbol":"BTC"}');
  });

  it('never appends a reason to a failed transaction', () => {
    expect(
      formatInvestmentImportWarning({
        warning: {
          code: 'TRANSACTION_FAILED',
          params: { symbol: 'AAPL', side: 'sell', date: '2026-01-02', reason: 'Cannot sell more shares' },
        },
        t,
      }).startsWith('investmentsImport.warnings.transactionFailed {'),
    ).toBe(true);
  });

  it('falls back to a generic message for a code this client does not know', () => {
    const warning = { code: 'SOMETHING_NEW', params: { symbol: 'X' } } as unknown as InvestmentImportWarning;

    expect(formatInvestmentImportWarning({ warning, t })).toBe('investmentsImport.warnings.unknown');
  });
});

import type { InvestmentImportWarning, InvestmentImportWarningCode } from '@bt/shared/types/investments';

type Translate = (key: string, named: Record<string, unknown>) => string;

const PREFIX = 'investmentsImport.warnings';

const KEY_BY_CODE: Record<InvestmentImportWarningCode, string> = {
  CSV_ROW_MISSING_SYMBOL: 'csvRowMissingSymbol',
  CSV_ROW_INVALID_DATE: 'csvRowInvalidDate',
  CSV_ROW_UNMAPPED_SIDE: 'csvRowUnmappedSide',
  CSV_ROW_INVALID_QUANTITY: 'csvRowInvalidQuantity',
  CSV_ROW_INVALID_PRICE: 'csvRowInvalidPrice',
  CSV_ROW_INVALID_FEES: 'csvRowInvalidFees',
  AI_ROWS_DROPPED: 'aiRowsDropped',
  CSV_ROWS_INVALID: 'csvRowsInvalid',
  CSV_ROWS_SKIPPED: 'csvRowsSkipped',
  UNSUPPORTED_QUOTE_CURRENCY: 'unsupportedQuoteCurrency',
  DUPLICATE_CHECK_FAILED: 'duplicateCheckFailed',
  PROVIDER_LOOKUP_FAILED: 'providerLookupFailed',
  NO_RESOLVED_SECURITY: 'noResolvedSecurity',
  NO_CURRENCY: 'noCurrency',
  PORTFOLIO_NOT_FOUND: 'portfolioNotFound',
  HOLDING_SETUP_FAILED: 'holdingSetupFailed',
  UNSUPPORTED_CATEGORY: 'unsupportedCategory',
  TRANSACTION_FAILED: 'transactionFailed',
};

/** Codes whose copy has a variant that appends the server's (already localized) reason. */
const CODES_WITH_REASON = new Set<InvestmentImportWarningCode>(['HOLDING_SETUP_FAILED']);

export function formatInvestmentImportWarning({
  warning,
  t,
}: {
  warning: InvestmentImportWarning;
  t: Translate;
}): string {
  const key = KEY_BY_CODE[warning.code];
  if (!key) return t(`${PREFIX}.unknown`, {});

  const params: Record<string, unknown> = { ...warning.params };
  if (typeof params.side === 'string') params.side = t(`investmentsImport.categories.${params.side}`, {});

  const withReason = CODES_WITH_REASON.has(warning.code) && typeof params.reason === 'string' && params.reason;
  return t(`${PREFIX}.${key}${withReason ? 'WithReason' : ''}`, params);
}

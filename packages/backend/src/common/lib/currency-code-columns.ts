/**
 * Every column that holds a currency code and is declared `varchar(CURRENCY_CODE_MAX_LENGTH)`.
 * Custom currencies carry codes longer than the ISO 4217 three letters, so the custom-currencies
 * migration widens these columns, and a model unit test keeps this list in step with the declarations.
 *
 * The migration does not read this list: it has its own frozen snapshot in
 * `migrations/utils/currency-code-columns-20261016.ts`, so a column added here never reaches it.
 *
 * Currency-code columns of investments (`Holdings`, `InvestmentTransactions`, `Securities`,
 * `SecurityCurrencyCaches`) are `varchar(255)` without a foreign key and are not listed: custom
 * codes are not accepted there.
 */

/** Longest currency code, custom or ISO. */
export const CURRENCY_CODE_MAX_LENGTH = 16;

/** Length of the ISO 4217 alphabetic codes the columns were declared with before custom currencies. */
export const ISO_CURRENCY_CODE_LENGTH = 3;

export interface CurrencyCodeColumnSpec {
  /** SQL table name. */
  table: string;
  /** SQL column name. */
  column: string;
}

export const CURRENCY_CODE_COLUMNS: readonly CurrencyCodeColumnSpec[] = [
  { table: 'Currencies', column: 'code' },
  { table: 'Accounts', column: 'currencyCode' },
  { table: 'BudgetPlans', column: 'currencyCode' },
  { table: 'ExchangeRates', column: 'baseCode' },
  { table: 'ExchangeRates', column: 'quoteCode' },
  { table: 'PortfolioBalances', column: 'currencyCode' },
  { table: 'PortfolioTransfers', column: 'currencyCode' },
  { table: 'PortfolioTransfers', column: 'toCurrencyCode' },
  { table: 'Portfolios', column: 'displayCurrencyCode' },
  { table: 'SubscriptionCandidates', column: 'currencyCode' },
  { table: 'Subscriptions', column: 'expectedCurrencyCode' },
  { table: 'TransactionTemplates', column: 'originalCurrencyCode' },
  { table: 'Transactions', column: 'currencyCode' },
  { table: 'Transactions', column: 'originalCurrencyCode' },
  { table: 'Transactions', column: 'refCurrencyCode' },
  { table: 'UserExchangeRates', column: 'baseCode' },
  { table: 'UserExchangeRates', column: 'quoteCode' },
  { table: 'UsersCurrencies', column: 'currencyCode' },
  { table: 'VentureDeals', column: 'currencyCode' },
  { table: 'VentureEventLinks', column: 'currencyCode' },
  { table: 'VentureEvents', column: 'currencyCode' },
];

export interface NullableRefColumnSpec {
  /** SQL table name. */
  table: string;
  /** SQL column name. A custom currency without a rate leaves it `NULL`. */
  column: string;
}

/**
 * Base-currency amounts that stay `NULL` while a custom currency has no rate to convert through.
 * Every one of them was `NOT NULL` before.
 */
export const NULLABLE_REF_COLUMNS: readonly NullableRefColumnSpec[] = [
  { table: 'Transactions', column: 'refAmount' },
  { table: 'Transactions', column: 'refCommissionRate' },
  { table: 'TransactionSplits', column: 'refAmount' },
  { table: 'Accounts', column: 'refCurrentBalance' },
  { table: 'Accounts', column: 'refInitialBalance' },
  { table: 'Accounts', column: 'refCreditLimit' },
];

/**
 * Every column that holds a currency code and is declared `varchar(CURRENCY_CODE_MAX_LENGTH)`.
 * Custom currencies carry codes longer than the ISO 4217 three letters, so the custom-currencies
 * migration widens these columns, and a model unit test keeps this list in step with the declarations.
 *
 * The migration does not read this list: it has its own frozen snapshot in
 * `migrations/utils/currency-code-columns-20261120.ts`, so a column added here never reaches it.
 *
 * Currency-code columns of investments (`Holdings`, `InvestmentTransactions`, `Securities`,
 * `SecurityCurrencyCaches`) are `varchar(255)` without a foreign key and are not listed: custom
 * codes are not accepted there.
 */

export { CURRENCY_CODE_MAX_LENGTH } from '@bt/shared/types';

interface CurrencyCodeColumnSpec {
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
  { table: 'Goals', column: 'currencyCode' },
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

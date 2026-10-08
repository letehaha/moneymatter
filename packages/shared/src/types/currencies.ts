import type { RecordId } from './record-id';
import type { UserModel } from './users';

/**
 * Identifies the exchange rate provider that supplied a given rate.
 * Persisted as the free-form `VARCHAR` `source` column on the `ExchangeRates`
 * table. This enum is the SOLE source of truth for valid values — so adding a
 * provider is a code-only change with no migration.
 */
export enum EXCHANGE_RATE_PROVIDER_TYPE {
  CURRENCY_RATES_API = 'currency-rates-api',
  FAWAZ_CURRENCY_API = 'fawaz-currency-api',
  API_LAYER = 'api-layer',
  /**
   * Catch-all for rows whose origin cannot be determined.
   * Used as the DB default – never set explicitly by a provider.
   */
  UNKNOWN = 'unknown',
}

export interface CurrencyModel {
  currency: string;
  digits: number;
  number: number;
  code: string;
  isDisabled: boolean;
}

export interface UserCurrencyModel {
  id: RecordId;
  userId: number;
  currencyCode: string;
  exchangeRate: number;
  liveRateUpdate: boolean;
  isDefaultCurrency: boolean;
  currency?: CurrencyModel;
  user?: UserModel;
}

export interface ExchangeRatesModel {
  baseCode: string;
  quoteCode: string;
  rate: number;
}

export interface UserExchangeRatesModel extends ExchangeRatesModel {
  userId: number;
  custom?: boolean;
}

/**
 * ISO 4217 "no currency". Bank data providers surface it when the institution
 * reports no currency for an account (brokerages, mostly); connecting such an
 * account requires an explicit currency choice from the user.
 */
export const NO_CURRENCY_CODE = 'XXX';

/**
 * Per-table counts returned by a base-currency recalculation: how many rows had
 * their `ref*` amounts rewritten into the new base. Surfaced as the change-base
 * job result so the client can confirm the sweep touched every table.
 */
export interface RecalculateResult {
  transactionsUpdated: number;
  accountsUpdated: number;
  loanDetailsUpdated: number;
  balancesRebuilt: number;
  investmentTransactionsUpdated: number;
  portfolioTransfersUpdated: number;
  holdingsUpdated: number;
  portfolioBalancesUpdated: number;
}

/**
 * Recalculation phases in execution order. Shared so the frontend's per-step
 * progress labels stay compile-linked to what the backend actually reports.
 */
export const BASE_CURRENCY_CHANGE_STEPS = [
  'transactions',
  'accounts',
  'loanDetails',
  'balances',
  'investmentTransactions',
  'portfolioTransfers',
  'holdings',
  'portfolioBalances',
] as const;

export type BaseCurrencyChangeStep = (typeof BASE_CURRENCY_CHANGE_STEPS)[number];

/**
 * Result of `GET /user/currencies/change-base/status`. The base-currency change
 * runs as a background job that any device polls to drive the blocking overlay.
 * `idle` covers both "never ran" and "job aged out of retention" — the endpoint
 * never 404s, since the frontend calls it on every boot.
 */
export type BaseCurrencyChangeStatus =
  | { state: 'idle' }
  | { state: 'queued'; jobId: string }
  | { state: 'running'; jobId: string; step?: BaseCurrencyChangeStep; startedAt?: number }
  | { state: 'completed'; jobId: string; finishedAt: number; result: RecalculateResult }
  | { state: 'failed'; jobId: string; finishedAt?: number; error: string };

// Exchange Rates
export interface ExchangeRatePairQuery {
  from: string;
  to: string;
  date: string; // yyyy-MM-dd
}

export interface ExchangeRatePairResponse {
  baseCode: string;
  quoteCode: string;
  /** ISO datetime of the rate actually used. Differs from the requested date when
   *  no rate existed for it and the nearest earlier one was substituted. */
  date: string;
  /** Quote units per 1 base unit: `toAmount = fromAmount * rate`. */
  rate: number;
  /** Present and true when the value is the user's own manual rate. */
  custom?: boolean;
}

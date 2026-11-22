import type { EntityLogoFields, EntityLogoWritePayload } from './entity-logo';
import { MAX_CURRENCY_DECIMALS } from './money';
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

/** Shortest currency code, ISO 4217 or user-defined. */
const CURRENCY_CODE_MIN_LENGTH = 2;
/** Longest currency code; the width of every currency-code column. */
export const CURRENCY_CODE_MAX_LENGTH = 16;
/** Shape of a currency code: uppercase letters and digits. Says nothing about whether the code exists. */
export const CURRENCY_CODE_PATTERN = new RegExp(`^[A-Z0-9]{${CURRENCY_CODE_MIN_LENGTH},${CURRENCY_CODE_MAX_LENGTH}}$`);

export const CUSTOM_CURRENCY_NAME_MAX_LENGTH = 255;
export const CUSTOM_CURRENCY_SYMBOL_MAX_LENGTH = 8;
export const CUSTOM_CURRENCY_DECIMALS_MIN = 0;
export const CUSTOM_CURRENCY_DECIMALS_MAX = MAX_CURRENCY_DECIMALS;

export interface CurrencyModel {
  currency: string;
  digits: number;
  /** ISO 4217 numeric code; `null` on a custom currency. */
  number: number | null;
  code: string;
  isDisabled: boolean;
  /** `true` for a user-defined code, `false` for the ISO 4217 seed. */
  isCustom: boolean;
  /** Symbol of a custom currency; `null` on ISO currencies. */
  symbol: string | null;
}

/**
 * How an amount in a currency is formatted, as the account owner defines it. Accounts and
 * transactions carry it so a collaborator's UI formats by the account rather than by its own list.
 */
export interface CurrencyMeta {
  /** Decimals the amounts in this currency keep. */
  decimals: number;
  /** Symbol of a custom currency; `null` for ISO currencies, which the client formats itself. */
  symbol: string | null;
  isCustom: boolean;
}

/** A user's custom currency as `/user/currencies/custom` returns it, overrides applied. */
export interface CustomCurrencyModel extends CurrencyMeta, EntityLogoFields {
  code: string;
  name: string;
  isCustom: true;
}

export interface CreateCustomCurrencyBody extends EntityLogoWritePayload {
  code: string;
  name: string;
  /** 0 to `MAX_CURRENCY_DECIMALS`. */
  decimals: number;
  symbol?: string | null;
  /** What one unit is worth in `quoteCode`, an ISO currency the user holds (default: the base currency). */
  rate: { value: number; quoteCode?: string };
}

export interface UpdateCustomCurrencyBody extends EntityLogoWritePayload {
  name?: string;
  /** Changing it is allowed only while none of the user's rows use the currency. */
  decimals?: number;
  symbol?: string | null;
}

/**
 * Where a custom currency's rates come from for one user. An ISO currency stays on `manual`: its
 * live-rate flag picks between the market feed and the user's own rate.
 */
export const CURRENCY_RATE_SOURCES = ['manual', 'peg', 'coingecko', 'http'] as const;
export type CurrencyRateSource = (typeof CURRENCY_RATE_SOURCES)[number];

/** Quote currency of the synced sources when the config names none. */
export const DEFAULT_RATE_SOURCE_QUOTE_CURRENCY = 'USD';

/** The rate is `factor` times the rate of `pegCurrency`, an ISO currency. */
export interface PegRateSourceConfig {
  pegCurrency: string;
  factor: number;
}

/** Daily prices of one CoinGecko coin, stored in `quoteCurrency`, an ISO currency. */
export interface CoingeckoRateSourceConfig {
  coinId: string;
  quoteCurrency: string;
}

/** One coin of `GET /user/currencies/coingecko/search`, the id a CoinGecko rate source is configured with. */
export interface CoingeckoCoinSearchResult {
  coinId: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  marketCapRank: number | null;
}

/** An HTTP source sends at most this many request headers. */
export const HTTP_RATE_SOURCE_MAX_HEADERS = 10;

/** The placeholders an HTTP source URL template may hold, written `{date}`, `{code}` and `{quote}`. */
export const HTTP_URL_TEMPLATE_PLACEHOLDER_NAMES = ['date', 'code', 'quote'] as const;
export type HttpUrlTemplatePlaceholderName = (typeof HTTP_URL_TEMPLATE_PLACEHOLDER_NAMES)[number];

/**
 * A JSON endpoint called once per day. `urlTemplate` may hold `{date}`, `{code}` and `{quote}`;
 * `jsonPath` points at the price in the response, and the rate is stored in `quoteCurrency`.
 * The request headers are secrets (usually an API key): they are stored encrypted and never
 * returned, only their names are.
 */
export interface HttpRateSourceConfig {
  urlTemplate: string;
  jsonPath: string;
  quoteCurrency: string;
  /** Names of the request headers the source sends; their values are never returned. */
  headerNames: string[];
}

/**
 * Settings of an `http` source as the editor sends them. `headers` is optional: omitted keeps the
 * headers already saved on an `http` source, `{}` removes them, an object replaces them.
 */
export interface HttpRateSourceInput {
  urlTemplate: string;
  jsonPath: string;
  quoteCurrency?: string;
  headers?: Record<string, string>;
}

/** Body of `POST /user/currencies/:code/rate-source/test`. `date` is the UTC day to ask for, today by default. */
export interface TestCurrencyRateSourceBody {
  rateSource: 'http';
  config: HttpRateSourceInput;
  date?: string;
}

/** Why a rate-source preview did not produce a rate. */
export const RATE_SOURCE_TEST_FAILURES = [
  'blocked',
  'https_required',
  'timeout',
  'network',
  'http_status',
  'too_large',
  'not_json',
  'path_not_found',
  'not_a_number',
  'headers_unreadable',
] as const;
export type RateSourceTestFailure = (typeof RATE_SOURCE_TEST_FAILURES)[number];

/** Response of `POST /user/currencies/:code/rate-source/test`; nothing is saved either way. */
export type TestCurrencyRateSourceResponse =
  | { ok: true; date: string; rate: number; quoteCurrency: string }
  | { ok: false; reason: RateSourceTestFailure; message: string };

/** Body of `PUT /user/currencies/:code/rate-source`. */
export type UpdateCurrencyRateSourceBody =
  | { rateSource: 'manual' }
  | { rateSource: 'peg'; config: PegRateSourceConfig }
  | {
      rateSource: 'coingecko';
      config: Omit<CoingeckoRateSourceConfig, 'quoteCurrency'> & { quoteCurrency?: string };
      /** The picked coin's https logo, stored as the currency's logo image; absent keeps the logo, `null` clears it. */
      logoUrl?: string | null;
    }
  | { rateSource: 'http'; config: HttpRateSourceInput };

/** A currency's saved rate source; the config is `null` for `manual`. */
export type CurrencyRateSourceSetting =
  | { rateSource: 'manual'; rateSourceConfig: null }
  | { rateSource: 'peg'; rateSourceConfig: PegRateSourceConfig }
  | { rateSource: 'coingecko'; rateSourceConfig: CoingeckoRateSourceConfig }
  | { rateSource: 'http'; rateSourceConfig: HttpRateSourceConfig };

/** Response of `PUT /user/currencies/:code/rate-source`. */
export type CurrencyRateSourceResponse = CurrencyRateSourceSetting & { currencyCode: string };

/** One stored rate of a custom currency, as listed by `GET /user/currencies/:code/rate-history`. */
export interface CurrencyRateHistoryItem {
  /** The currency the rate is quoted in: one unit of the custom currency is worth `rate` of it. */
  quoteCode: string;
  rate: number;
  /** Calendar day (YYYY-MM-DD) the rate starts to apply. */
  effectiveDate: string;
  source: UserExchangeRateSource;
  /** ISO instant the row was written. */
  writtenAt: string;
  /** Whether this is the rate that values the currency in the base currency today. */
  isInForce: boolean;
}

/** Response of `GET /user/currencies/:code/rate-history`; `totalCount` is set on the first page only. */
export interface CurrencyRateHistoryResponse {
  items: CurrencyRateHistoryItem[];
  totalCount: number | null;
}

/** The logo fields carry a custom currency's logo; always `null` on an ISO currency. */
export interface UserCurrencyModel extends EntityLogoFields {
  id: RecordId;
  userId: number;
  currencyCode: string;
  exchangeRate: number;
  liveRateUpdate: boolean;
  isDefaultCurrency: boolean;
  /** Raw custom definition: its name. `currency` already carries it; always `null` on an ISO currency. */
  nameOverride: string | null;
  /** Raw custom definition: its symbol. `currency` already carries it; always `null` on an ISO currency. */
  symbolOverride: string | null;
  /** Raw custom definition: its decimals. `currency` already carries them; always `null` on an ISO currency. */
  decimalsOverride: number | null;
  /** Where the currency's rates come from; `manual` until the user picks another source for a custom currency. */
  rateSource: CurrencyRateSource;
  /** Settings of the source; `null` for `manual`. */
  rateSourceConfig: PegRateSourceConfig | CoingeckoRateSourceConfig | HttpRateSourceConfig | null;
  currency?: CurrencyModel;
  user?: UserModel;
}

export interface ExchangeRatesModel {
  baseCode: string;
  quoteCode: string;
  rate: number;
}

/**
 * Where a stored user rate came from. `initial` is the rate a custom currency was created with: a
 * synced source may replace it on its day, and a manual edit of that day makes it `manual`.
 */
export const USER_EXCHANGE_RATE_SOURCES = ['manual', 'initial', 'coingecko', 'http'] as const;
export type UserExchangeRateSource = (typeof USER_EXCHANGE_RATE_SOURCES)[number];

export interface UserExchangeRatesModel extends ExchangeRatesModel {
  userId: number;
  custom?: boolean;
  /** Calendar day (YYYY-MM-DD) the rate starts to apply. Only rates of custom currencies are read by day. */
  effectiveDate: string;
  source: UserExchangeRateSource;
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

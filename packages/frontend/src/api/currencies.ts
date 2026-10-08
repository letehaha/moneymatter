import { api } from '@/api/_api';
import {
  type BaseCurrencyChangeStatus,
  CurrencyModel,
  ExchangeRatesModel,
  RefBalanceRemeasureResult,
  UserCurrencyModel,
  UserExchangeRatesModel,
  type ExchangeRatePairQuery,
  type ExchangeRatePairResponse,
} from '@bt/shared/types';

export const getAllCurrencies = async (): Promise<CurrencyModel[]> => api.get('/models/currencies');

export const loadUserCurrencies = async (): Promise<UserCurrencyModel[]> => api.get('/user/currencies');

export const deleteCustomRate = (
  pairs: {
    baseCode: string;
    quoteCode: string;
  }[],
): Promise<{ remeasure: RefBalanceRemeasureResult }> => api.delete('/user/currency/rates', { data: { pairs } });

export const loadUserCurrenciesExchangeRates = async (): Promise<UserExchangeRatesModel[]> =>
  api.get('/user/currencies/rates');

/**
 * System (market) exchange rates for a calendar date, in the canonical
 * USD-pivot direction (`baseCode: 'USD', quoteCode: X` = 1 USD in X). Returns
 * `null` when no rates are stored for that date.
 */
export const loadExchangeRatesForDate = async (date: string): Promise<ExchangeRatesModel[] | null> =>
  api.get(`/currencies/rates/${date}`);

/**
 * Rate for an arbitrary pair on a calendar date (`yyyy-MM-dd`), covering any ISO
 * currency rather than only the user's linked ones. Falls back to the nearest
 * earlier stored rate, and rejects when none exists near the date.
 */
export const getExchangeRatePair = async ({
  from,
  to,
  date,
  silent,
}: ExchangeRatePairQuery & { silent?: boolean }): Promise<ExchangeRatePairResponse> =>
  api.get('/currencies/rates/pair', { from, to, date }, { silent });

export const editUserCurrenciesExchangeRates = async (
  pairs: {
    baseCode: string;
    quoteCode: string;
    rate: number;
  }[],
): Promise<{ rates: UserExchangeRatesModel[]; remeasure: RefBalanceRemeasureResult }> =>
  api.put('/user/currency/rates', { pairs });

export const deleteUserCurrency = (currencyCode: string) => api.delete('/user/currency', { data: { currencyCode } });

export const setBaseUserCurrency = (currencyCode: string) => api.post('/user/currencies/base', { currencyCode });

/**
 * Enqueues the base-currency recalculation as a background job. Resolves as soon
 * as the job is queued — progress is tracked via `getBaseCurrencyChangeStatus`.
 */
export const changeBaseCurrency = (newCurrencyCode: string): Promise<{ jobId: string; state: 'queued' }> =>
  api.post('/user/currencies/change-base', { newCurrencyCode });

/**
 * Current state of the user's base-currency change job. Returns `idle` when no
 * change is in flight, so it is safe to call on every app boot.
 */
export const getBaseCurrencyChangeStatus = (): Promise<BaseCurrencyChangeStatus> =>
  api.get('/user/currencies/change-base/status');

export const addUserCurrencies = async (
  currencies: {
    currencyCode: string;
    exchangeRate?: number;
    liveRateUpdate?: boolean;
  }[],
) => api.post('/user/currencies', { currencies });

export const loadUserBaseCurrency = (): Promise<UserCurrencyModel> => api.get('/user/currencies/base');

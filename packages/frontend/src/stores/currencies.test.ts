import { getCurrencyDecimals, resetCurrencyDecimals } from '@/js/helpers/currency-decimals';
import type { CurrencyModel, UserCurrencyModel } from '@bt/shared/types';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCurrenciesStore } from './currencies';

const { api } = vi.hoisted(() => ({
  api: { getAllCurrencies: vi.fn(), loadUserCurrencies: vi.fn(), loadUserBaseCurrency: vi.fn() },
}));

vi.mock('@/api/currencies', () => api);

vi.mock('@/lib/query-client', () => ({
  invalidatePersistedQuery: vi.fn(),
  queryClient: { fetchQuery: ({ queryFn }: { queryFn: () => unknown }) => queryFn() },
}));

const system = (code: string) => ({ code }) as CurrencyModel;
const linked = ({ id, code }: { id: number; code: string }) =>
  ({ id, currencyCode: code }) as unknown as UserCurrencyModel;

describe('currencies store', () => {
  beforeEach(() => {
    resetCurrencyDecimals();
    setActivePinia(createPinia());
    api.getAllCurrencies.mockResolvedValue(['AED', 'EUR', 'GEL', 'UAH', 'USD'].map(system));
    api.loadUserCurrencies.mockResolvedValue([linked({ id: 1, code: 'USD' }), linked({ id: 2, code: 'EUR' })]);
  });

  it('lists linked currencies first and keeps the original order inside each group', async () => {
    const store = useCurrenciesStore();

    await store.loadCurrencies();

    expect(store.systemCurrencies.map((item) => item.code)).toEqual(['EUR', 'USD', 'AED', 'GEL', 'UAH']);
  });

  it('moves a base currency linked outside loadCurrencies to the front', async () => {
    const store = useCurrenciesStore();
    await store.loadCurrencies();
    api.loadUserBaseCurrency.mockResolvedValue(linked({ id: 3, code: 'UAH' }));

    await store.loadBaseCurrency();

    expect(store.systemCurrencies.map((item) => item.code)).toEqual(['EUR', 'USD', 'UAH', 'AED', 'GEL']);
  });

  it('registers the decimals of every loaded currency by code', async () => {
    api.getAllCurrencies.mockResolvedValue([
      { code: 'KWD', digits: 3 },
      { code: 'JPY', digits: 0 },
      { code: 'USDT', digits: 6 },
    ]);
    const store = useCurrenciesStore();

    await store.loadCurrencies();

    expect(getCurrencyDecimals({ code: 'KWD' })).toBe(3);
    expect(getCurrencyDecimals({ code: 'JPY' })).toBe(0);
    expect(getCurrencyDecimals({ code: 'USDT' })).toBe(6);
  });

  it('registers the decimals of the base currency', async () => {
    api.loadUserBaseCurrency.mockResolvedValue({
      id: 3,
      currencyCode: 'USDT',
      currency: { code: 'USDT', digits: 6 },
    });
    const store = useCurrenciesStore();

    await store.loadBaseCurrency();

    expect(getCurrencyDecimals({ code: 'USDT' })).toBe(6);
  });
});

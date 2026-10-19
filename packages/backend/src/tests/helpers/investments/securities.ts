import { until } from '@common/helpers';
import { jest } from '@jest/globals';
import type Securities from '@models/investments/securities.model';
import { FmpClient, type FmpSearchResult } from '@root/services/investments/data-providers/clients/fmp-client';
import { addSecurityFromSearch } from '@root/services/investments/securities/add-from-search.service';
import * as getSecuritiesService from '@root/services/investments/securities/get-all';
import { searchSecurities as _searchSecurities } from '@root/services/investments/securities/search.service';

import { type MakeRequestReturn, makeRequest } from '../common';

export async function triggerSecuritiesSync<R extends boolean | undefined = false>({
  raw,
}: {
  raw?: R;
} = {}): Promise<MakeRequestReturn<{ message: string }, R>> {
  return makeRequest({
    method: 'post',
    url: '/investments/sync/securities-prices',
    raw,
  });
}
export async function getAllSecurities<R extends boolean | undefined = false>({
  raw,
}: {
  raw?: R;
} = {}) {
  return makeRequest<Awaited<ReturnType<typeof getSecuritiesService.getSecurities>>, R>({
    method: 'get',
    url: '/investments/securities',
    raw,
  });
}

type SeedSecurityPayload = {
  symbol: string;
  name: string;
  currencyCode?: string;
  type?: string;
};

/**
 * Runs `security` through the search endpoint with FMP mocked to return it, so the server
 * remembers the result as provider-verified. Returns the search result as the client gets it.
 */
export async function searchSecurityViaFmp(security: SeedSecurityPayload) {
  const { dataProviderFactory } = await import('@root/services/investments/data-providers/provider-factory');
  dataProviderFactory.clearCache();
  const mockedFmpClient = jest.mocked(FmpClient);
  mockedFmpClient.mockReset();
  const mockFmpSearch = jest.fn<() => Promise<FmpSearchResult[]>>().mockResolvedValue([
    {
      symbol: security.symbol,
      name: security.name,
      currency: security.currencyCode || 'USD',
      stockExchange: 'NASDAQ Global Select',
      exchangeShortName: 'NASDAQ',
    },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedFmpClient.mockImplementation(() => ({ search: mockFmpSearch }) as any);

  const [searchResult] = await searchSecurities({
    payload: { query: security.symbol },
    raw: true,
  });
  mockFmpSearch.mockReset();

  if (!searchResult) {
    throw new Error(`Failed to get search result for ${security.symbol}`);
  }

  return searchResult;
}

/** Creates securities through the search endpoint followed by `addSecurityFromSearch`. */
export async function seedSecurities(securitiesToSeed: SeedSecurityPayload[]) {
  const createdSecurities: Securities[] = [];

  for (const security of securitiesToSeed) {
    const searchResult = await searchSecurityViaFmp(security);
    const { security: createdSecurity } = await addSecurityFromSearch({ searchResult });
    createdSecurities.push(createdSecurity);
  }

  // Wait until the database reflects all changes
  await until(
    async () => {
      const securities = await getAllSecurities({ raw: true });
      return securities.length >= securitiesToSeed.length;
    },
    { timeout: 5000, interval: 100 },
  );

  return createdSecurities;
}

export async function searchSecurities<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: Omit<Parameters<typeof _searchSecurities>[0], 'user'>;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _searchSecurities>>, R>({
    method: 'get',
    url: '/investments/securities/search',
    payload,
    raw,
  });
}

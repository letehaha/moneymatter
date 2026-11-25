import { ASSET_CLASS, SECURITY_PROVIDER, SecuritySearchResult } from '@bt/shared/types/investments';
import { bulkUploadSecurityPrices as _bulkUploadSecurityPrices } from '@root/services/investments/securities-price/bulk-upload-prices.service';
import { getPriceUploadInfo as _getPriceUploadInfo } from '@root/services/investments/securities-price/get-price-upload-info.service';
import { getPrices } from '@root/services/investments/securities-price/get-prices.service';

import { makeRequest } from '../common';

export async function getSecuritiesPricesByDate<R extends boolean | undefined = false>({
  params = {},
  raw,
}: {
  params?: {
    securityId?: string;
    from?: Date;
    to?: Date;
    daily?: boolean;
  };
  raw?: R;
}) {
  const queryParams: string[] = [];

  if (params.securityId) {
    queryParams.push(`securityId=${params.securityId}`);
  }
  if (params.from) {
    queryParams.push(`from=${params.from.toISOString()}`);
  }
  if (params.to) {
    queryParams.push(`to=${params.to.toISOString()}`);
  }
  if (params.daily !== undefined) {
    queryParams.push(`daily=${params.daily}`);
  }

  const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

  const url = `/investments/prices${queryString}`;

  return makeRequest<Awaited<ReturnType<typeof getPrices>>, R>({
    method: 'get',
    url,
    raw,
  });
}

export async function getPriceUploadInfo<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: Parameters<typeof _getPriceUploadInfo>[0];
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _getPriceUploadInfo>>, R>({
    method: 'post',
    url: '/investments/securities/price-upload-info',
    payload,
    raw,
  });
}

export async function bulkUploadSecurityPrices<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: Parameters<typeof _bulkUploadSecurityPrices>[0];
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _bulkUploadSecurityPrices>>, R>({
    method: 'post',
    url: '/investments/securities/prices/bulk-upload',
    payload,
    raw,
  });
}

export function buildSecuritySearchResult(overrides?: Partial<SecuritySearchResult>): SecuritySearchResult {
  return {
    symbol: 'TEST',
    providerSymbol: 'TEST',
    name: 'Test Security',
    assetClass: ASSET_CLASS.stocks,
    providerName: SECURITY_PROVIDER.fmp,
    currencyCode: 'USD',
    exchangeName: 'Test Exchange',
    exchangeAcronym: 'TEST',
    ...overrides,
  };
}

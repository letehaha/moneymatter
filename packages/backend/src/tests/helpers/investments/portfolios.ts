import {
  PORTFOLIO_TYPE,
  type PortfolioActivityFilter,
  type PortfolioActivityResponse,
  type PortfolioValueHistoryInterval,
} from '@bt/shared/types/investments';
import { removeUndefinedKeys } from '@js/helpers';
import { getPortfolioAnalytics as _getPortfolioAnalytics } from '@services/investments/portfolios/analytics/get-portfolio-analytics.service';
import { getPortfolioBalances as _getPortfolioBalances } from '@services/investments/portfolios/balances';
import { updatePortfolioBalance as _updatePortfolioBalance } from '@services/investments/portfolios/balances';
import { createPortfolio as _createPortfolio } from '@services/investments/portfolios/create.service';
import { deletePortfolio as _deletePortfolio } from '@services/investments/portfolios/delete.service';
import { getPortfolioSummaries as _getPortfolioSummaries } from '@services/investments/portfolios/get-portfolio-summaries.service';
import { getPortfolioSummary as _getPortfolioSummary } from '@services/investments/portfolios/get-portfolio-summary.service';
import { getPortfolioValueHistory as _getPortfolioValueHistory } from '@services/investments/portfolios/get-portfolio-value-history.service';
import { getPortfoliosAnnualizedReturns as _getPortfoliosAnnualizedReturns } from '@services/investments/portfolios/get-portfolios-annualized-returns.service';
import { getPortfolio as _getPortfolio } from '@services/investments/portfolios/get.service';
import { listPortfolios as _listPortfolios } from '@services/investments/portfolios/list.service';
import { restorePortfolio as _restorePortfolio } from '@services/investments/portfolios/restore.service';
import { updatePortfolio as _updatePortfolio } from '@services/investments/portfolios/update.service';

import { makeRequest } from '../common';

export function buildPortfolioPayload({
  name = 'Test Portfolio',
  portfolioType = PORTFOLIO_TYPE.investment,
  description = 'Test portfolio description',
  displayCurrencyCode,
  externalUrl,
  isEnabled = true,
}: Partial<Omit<Parameters<typeof _createPortfolio>[0], 'userId'>> = {}): Omit<
  Parameters<typeof _createPortfolio>[0],
  'userId'
> {
  return {
    name,
    portfolioType,
    description,
    ...(displayCurrencyCode !== undefined ? { displayCurrencyCode } : {}),
    ...(externalUrl !== undefined ? { externalUrl } : {}),
    isEnabled,
  };
}

export async function createPortfolio<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload?: Partial<ReturnType<typeof buildPortfolioPayload>>;
  raw?: R;
} = {}) {
  return makeRequest<Awaited<ReturnType<typeof _createPortfolio>>, R>({
    method: 'post',
    url: '/investments/portfolios',
    payload: buildPortfolioPayload(payload),
    raw,
  });
}

export async function listPortfolios<R extends boolean | undefined = false>({
  portfolioType,
  isEnabled,
  onlyDeleted,
  limit,
  offset,
  page,
  raw,
}: {
  portfolioType?: PORTFOLIO_TYPE;
  isEnabled?: boolean;
  onlyDeleted?: boolean;
  limit?: number;
  offset?: number;
  page?: number;
  raw?: R;
} = {}) {
  return makeRequest<
    { data: Awaited<ReturnType<typeof _listPortfolios>>; pagination: { limit: number; offset: number; page: number } },
    R
  >({
    method: 'get',
    url: '/investments/portfolios',
    payload: removeUndefinedKeys({ portfolioType, isEnabled, onlyDeleted, limit, offset, page }),
    raw,
  });
}

export async function getPortfolio<R extends boolean | undefined = false>({
  portfolioId,
  raw,
}: {
  portfolioId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _getPortfolio>>, R>({
    method: 'get',
    url: `/investments/portfolios/${portfolioId}`,
    raw,
  });
}

export async function getPortfolioBalance<R extends boolean | undefined = false>({
  portfolioId,
  currencyCode,
  raw,
}: {
  portfolioId: string;
  currencyCode?: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _getPortfolioBalances>>, R>({
    method: 'get',
    url: `/investments/portfolios/${portfolioId}/balance`,
    payload: removeUndefinedKeys({ currencyCode }),
    raw,
  });
}

export async function updatePortfolio<R extends boolean | undefined = false>({
  portfolioId,
  payload,
  raw,
}: {
  portfolioId: string;
  payload: Partial<Omit<Parameters<typeof _updatePortfolio>[0], 'userId' | 'portfolioId'>>;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _updatePortfolio>>, R>({
    method: 'put',
    url: `/investments/portfolios/${portfolioId}`,
    payload,
    raw,
  });
}

export async function deletePortfolio<R extends boolean | undefined = false>({
  portfolioId,
  force,
  raw,
}: {
  portfolioId: string;
  force?: boolean;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _deletePortfolio>>, R>({
    method: 'delete',
    url: `/investments/portfolios/${portfolioId}`,
    payload: removeUndefinedKeys({ force }),
    raw,
  });
}

export async function restorePortfolio<R extends boolean | undefined = false>({
  portfolioId,
  raw,
}: {
  portfolioId: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _restorePortfolio>>, R>({
    method: 'post',
    url: `/investments/portfolios/${portfolioId}/restore`,
    raw,
  });
}

export async function updatePortfolioBalance<R extends boolean | undefined = false>({
  portfolioId,
  currencyCode,
  availableCashDelta,
  totalCashDelta,
  setAvailableCash,
  setTotalCash,
  raw,
}: {
  portfolioId: string;
  currencyCode: string;
  availableCashDelta?: string;
  totalCashDelta?: string;
  setAvailableCash?: string;
  setTotalCash?: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _updatePortfolioBalance>>, R>({
    method: 'put',
    url: `/investments/portfolios/${portfolioId}/balance`,
    payload: removeUndefinedKeys({
      currencyCode,
      availableCashDelta,
      totalCashDelta,
      setAvailableCash,
      setTotalCash,
    }),
    raw,
  });
}

export async function getPortfolioSummary<R extends boolean | undefined = false>({
  portfolioId,
  date,
  raw,
}: {
  portfolioId: string;
  date?: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _getPortfolioSummary>>, R>({
    method: 'get',
    url: `/investments/portfolios/${portfolioId}/summary`,
    payload: removeUndefinedKeys({ date }),
    raw,
  });
}

export async function getPortfolioValueHistory<R extends boolean | undefined = false>({
  portfolioId,
  from,
  to,
  interval,
  raw,
}: {
  portfolioId: string;
  from?: string;
  to?: string;
  interval?: PortfolioValueHistoryInterval;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _getPortfolioValueHistory>>, R>({
    method: 'get',
    url: `/investments/portfolios/${portfolioId}/value-history`,
    payload: removeUndefinedKeys({ from, to, interval }),
    raw,
  });
}

export async function getPortfolioAnalytics<R extends boolean | undefined = false>({
  portfolioId,
  from,
  to,
  benchmark,
  raw,
}: {
  portfolioId: string;
  from?: string;
  to?: string;
  benchmark?: string;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _getPortfolioAnalytics>>, R>({
    method: 'get',
    url: `/investments/portfolios/${portfolioId}/analytics`,
    payload: removeUndefinedKeys({ from, to, benchmark }),
    raw,
  });
}

export async function getPortfolioSummaries<R extends boolean | undefined = false>({
  raw,
}: {
  raw?: R;
} = {}) {
  return makeRequest<Awaited<ReturnType<typeof _getPortfolioSummaries>>, R>({
    method: 'get',
    url: '/investments/portfolios/summaries',
    raw,
  });
}

export async function getPortfoliosAnnualizedReturns<R extends boolean | undefined = false>({
  asOf,
  raw,
}: {
  asOf?: string;
  raw?: R;
} = {}) {
  return makeRequest<Awaited<ReturnType<typeof _getPortfoliosAnnualizedReturns>>, R>({
    method: 'get',
    url: '/investments/portfolios/annualized-returns',
    payload: asOf === undefined ? undefined : { asOf },
    raw,
  });
}

export async function getPortfolioActivity<R extends boolean | undefined = false>({
  portfolioId,
  type,
  limit,
  offset,
  raw,
}: {
  portfolioId: string;
  type?: PortfolioActivityFilter;
  limit?: number;
  offset?: number;
  raw?: R;
}) {
  return makeRequest<PortfolioActivityResponse, R>({
    method: 'get',
    url: `/investments/portfolios/${portfolioId}/activity`,
    payload: removeUndefinedKeys({ type, limit, offset }),
    raw,
  });
}

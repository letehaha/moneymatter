import { api } from '@/api/_api';
import type { EntityLogoFields, NonImageLogoPayload } from '@bt/shared/types';
import {
  PORTFOLIO_TYPE,
  PortfolioBalanceModel,
  PortfolioModel,
  PortfolioTransferModel,
} from '@bt/shared/types/investments';
import type { PortfolioAnnualizedReturnModel } from '@bt/shared/types/investments/portfolio-annualized-return.model';
import type { PortfolioSummaryModel } from '@bt/shared/types/investments/portfolio-summary.model';

interface CreatePortfolioRequest {
  name: string;
  portfolioType?: PORTFOLIO_TYPE;
  description?: string;
  /** Currency for displaying portfolio summary/stats. Null/omitted = user's base currency. */
  displayCurrencyCode?: string | null;
  isEnabled?: boolean;
}

export const createPortfolio = async (params: CreatePortfolioRequest): Promise<PortfolioModel> => {
  const result = await api.post('/investments/portfolios', params);
  return result;
};

export const getPortfolios = async (): Promise<PortfolioModel[]> => {
  const result = await api.get('/investments/portfolios');
  return result.data;
};

export const getDeletedPortfolios = async (): Promise<PortfolioModel[]> => {
  const result = await api.get('/investments/portfolios', { onlyDeleted: true });
  return result.data;
};

export const restorePortfolio = async ({ portfolioId }: { portfolioId: string }): Promise<PortfolioModel> => {
  return api.post(`/investments/portfolios/${portfolioId}/restore`);
};

export const getPortfolio = async ({ portfolioId }: { portfolioId: string }): Promise<PortfolioModel> => {
  const result = await api.get(`/investments/portfolios/${portfolioId}`);
  return result;
};

type UpdatePortfolioParams = {
  portfolioId: string;
} & Partial<Omit<CreatePortfolioRequest, 'portfolioType'> & { portfolioType: PORTFOLIO_TYPE }> &
  NonImageLogoPayload;

export const updatePortfolio = async ({ portfolioId, ...params }: UpdatePortfolioParams): Promise<PortfolioModel> => {
  const result = await api.put(`/investments/portfolios/${portfolioId}`, params);
  return result;
};

export const deletePortfolio = async ({
  portfolioId,
  force,
}: {
  portfolioId: string;
  force?: boolean;
}): Promise<void> => {
  return api.delete(`/investments/portfolios/${portfolioId}`, { data: { force } });
};

interface CreatePortfolioTransferRequest {
  toPortfolioId: string;
  currencyCode: string;
  amount: string;
  date: string;
  description?: string;
}

type CreatePortfolioTransferParams = { fromPortfolioId: string } & CreatePortfolioTransferRequest;

export const createPortfolioTransfer = async ({
  fromPortfolioId,
  ...params
}: CreatePortfolioTransferParams): Promise<PortfolioTransferModel> => {
  const result = await api.post(`/investments/portfolios/${fromPortfolioId}/transfer`, params);
  return result;
};

interface AccountToPortfolioTransferRequest {
  accountId: string;
  amount: string;
  date: string;
  description?: string;
}

type AccountToPortfolioTransferParams = { portfolioId: string } & AccountToPortfolioTransferRequest;

export const accountToPortfolioTransfer = async ({
  portfolioId,
  ...params
}: AccountToPortfolioTransferParams): Promise<PortfolioTransferModel> => {
  const result = await api.post(`/investments/portfolios/${portfolioId}/transfer/from-account`, params);
  return result;
};

interface PortfolioToAccountTransferRequest {
  accountId: string;
  amount: string;
  currencyCode: string;
  date: string;
  description?: string;
}

type PortfolioToAccountTransferParams = { portfolioId: string } & PortfolioToAccountTransferRequest;

export const portfolioToAccountTransfer = async ({
  portfolioId,
  ...params
}: PortfolioToAccountTransferParams): Promise<PortfolioTransferModel> => {
  const result = await api.post(`/investments/portfolios/${portfolioId}/transfer/to-account`, params);
  return result;
};

interface ExchangeCurrencyRequest {
  fromCurrencyCode: string;
  toCurrencyCode: string;
  fromAmount: string;
  toAmount: string;
  date: string;
  description?: string;
}

type ExchangeCurrencyParams = { portfolioId: string } & ExchangeCurrencyRequest;

export const exchangeCurrency = async ({
  portfolioId,
  ...params
}: ExchangeCurrencyParams): Promise<PortfolioTransferModel> => {
  const result = await api.post(`/investments/portfolios/${portfolioId}/exchange-currency`, params);
  return result;
};

export const getPortfolioBalances = async ({
  portfolioId,
}: {
  portfolioId: string;
}): Promise<PortfolioBalanceModel[]> => {
  const result = await api.get(`/investments/portfolios/${portfolioId}/balance`);
  return result;
};

export const getPortfolioTransfers = async ({
  portfolioId,
  limit,
  offset,
}: {
  portfolioId: string;
  limit?: number;
  offset?: number;
}): Promise<PortfolioTransferModel[]> => {
  const result = await api.get(`/investments/portfolios/${portfolioId}/transfers`, { limit, offset });
  return result.data;
};

interface DirectCashTransactionRequest {
  type: 'deposit' | 'withdrawal';
  amount: string;
  currencyCode: string;
  date: string;
  description?: string | null;
  isAdjustment?: boolean;
}

type DirectCashTransactionParams = { portfolioId: string } & DirectCashTransactionRequest;

export const createDirectCashTransaction = async ({
  portfolioId,
  ...params
}: DirectCashTransactionParams): Promise<PortfolioTransferModel> => {
  const result = await api.post(`/investments/portfolios/${portfolioId}/cash-transaction`, params);
  return result;
};

export const setTransferAdjustment = async ({
  portfolioId,
  transferId,
  isAdjustment,
}: {
  portfolioId: string;
  transferId: string;
  isAdjustment: boolean;
}): Promise<PortfolioTransferModel> => {
  const result = await api.patch(`/investments/portfolios/${portfolioId}/transfers/${transferId}/adjustment`, {
    isAdjustment,
  });
  return result;
};

export const deletePortfolioTransfer = async ({
  portfolioId,
  transferId,
  deleteLinkedTransaction,
}: {
  portfolioId: string;
  transferId: string;
  deleteLinkedTransaction?: boolean;
}): Promise<void> => {
  const query: Record<string, string> = {};
  if (deleteLinkedTransaction !== undefined) {
    query.deleteLinkedTransaction = String(deleteLinkedTransaction);
  }
  return api.delete(`/investments/portfolios/${portfolioId}/transfers/${transferId}`, { query });
};

export const linkTransactionToPortfolio = async ({
  transactionId,
  portfolioId,
  affectsCash,
}: {
  transactionId: string;
  portfolioId: string;
  affectsCash?: boolean;
}): Promise<PortfolioTransferModel> => {
  const result = await api.post(`/transactions/${transactionId}/link-to-portfolio`, { portfolioId, affectsCash });
  return result;
};

export const unlinkTransactionFromPortfolio = async ({ transactionId }: { transactionId: string }): Promise<void> => {
  return api.post(`/transactions/${transactionId}/unlink-from-portfolio`);
};

interface TransactionPortfolioLinkResponse extends EntityLogoFields {
  transferId: string;
  portfolioId: string;
  portfolioName: string;
  /** True when the linked portfolio is currently in the trash. */
  isPortfolioDeleted: boolean;
  transferType: 'deposit' | 'withdrawal';
  amount: string;
  currencyCode: string;
  date: string;
  affectsCash: boolean;
}

export const getTransactionPortfolioLink = async ({
  transactionId,
}: {
  transactionId: string;
}): Promise<TransactionPortfolioLinkResponse> => {
  const result = await api.get(`/transactions/${transactionId}/portfolio-link`);
  return result;
};

export const getPortfolioSummary = async ({
  portfolioId,
  date,
}: {
  portfolioId: string;
  date?: string;
}): Promise<PortfolioSummaryModel> => {
  const params = date ? { date } : {};
  const result = await api.get(`/investments/portfolios/${portfolioId}/summary`, params);
  return result;
};

export const getPortfolioSummaries = async (): Promise<PortfolioSummaryModel[]> => {
  const result = await api.get('/investments/portfolios/summaries');
  return result;
};

export const getPortfoliosAnnualizedReturns = async ({ asOf }: { asOf?: string } = {}): Promise<
  PortfolioAnnualizedReturnModel[]
> => {
  const result = await api.get('/investments/portfolios/annualized-returns', asOf ? { asOf } : undefined);
  return result;
};

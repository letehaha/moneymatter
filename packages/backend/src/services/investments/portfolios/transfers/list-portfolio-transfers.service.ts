import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Accounts from '@models/accounts.model';
import Currencies from '@models/currencies.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import { Includeable, Op } from 'sequelize';

export const PORTFOLIO_TRANSFER_INCLUDES: Includeable[] = [
  { model: Portfolios, as: 'fromPortfolio' },
  { model: Portfolios, as: 'toPortfolio' },
  { model: Accounts, as: 'fromAccount', attributes: ['id', 'name', 'currencyCode', 'type'] },
  { model: Accounts, as: 'toAccount', attributes: ['id', 'name', 'currencyCode', 'type'] },
  { model: Currencies, as: 'currency' },
  { model: Currencies, as: 'toCurrency' },
];

interface ListPortfolioTransfersParams {
  userId: number;
  portfolioId: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'date' | 'amount';
  sortDirection?: 'ASC' | 'DESC';
}

export async function listPortfolioTransfers({
  userId,
  portfolioId,
  from,
  to,
  limit = 20,
  offset = 0,
  sortBy = 'date',
  sortDirection = 'DESC',
}: ListPortfolioTransfersParams) {
  // Verify portfolio exists and user owns it
  await findOrThrowNotFound({
    query: Portfolios.findOne({
      where: { id: portfolioId, userId },
    }),
    message: t({ key: 'investments.portfolioNotFound' }),
  });

  // Build date filter if provided
  const dateFilter = {};
  if (from || to) {
    dateFilter['date'] = {};
    if (from) {
      dateFilter['date'][Op.gte] = from;
    }
    if (to) {
      dateFilter['date'][Op.lte] = to;
    }
  }

  // Build where clause to find transfers involving this portfolio
  // (either as source or destination, including account↔portfolio transfers)
  const whereClause = {
    userId,
    [Op.or]: [{ fromPortfolioId: portfolioId }, { toPortfolioId: portfolioId }],
    ...dateFilter,
  };

  // Get total count for pagination
  const totalCount = await PortfolioTransfers.count({
    where: whereClause,
  });

  // Get transfers with sorting and pagination
  const transfers = await PortfolioTransfers.findAll({
    where: whereClause,
    include: PORTFOLIO_TRANSFER_INCLUDES,
    order: [
      [sortBy, sortDirection],
      ['createdAt', sortDirection],
    ],
    limit,
    offset,
  });

  return {
    data: transfers,
    totalCount,
  };
}

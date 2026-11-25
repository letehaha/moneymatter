import {
  INVESTMENT_TRANSACTION_CATEGORY,
  PORTFOLIO_ACTIVITY_FILTERS,
  type PortfolioActivityFilter,
  type PortfolioActivityItem,
} from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { connection } from '@models/connection';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import { PORTFOLIO_TRANSFER_INCLUDES } from '@services/investments/portfolios/transfers/list-portfolio-transfers.service';
import { QueryTypes } from 'sequelize';

const TRADES_SQL = `
  SELECT 'trade' AS kind, it.id, it."date" AS "sortDate", it."createdAt"
    FROM "InvestmentTransactions" it
   WHERE it."portfolioId" = :portfolioId`;

// DATEONLY transfers sort at UTC midnight of their day, the same instant a date-only trade is stored at.
const TRANSFERS_SQL = `
  SELECT 'transfer' AS kind, pt.id, (pt."date"::timestamp AT TIME ZONE 'UTC') AS "sortDate", pt."createdAt"
    FROM "PortfolioTransfers" pt
   WHERE pt."userId" = :userId
     AND (pt."fromPortfolioId" = :portfolioId OR pt."toPortfolioId" = :portfolioId)`;

const buildActivitySql = ({ type }: { type: PortfolioActivityFilter }) => {
  switch (type) {
    case PORTFOLIO_ACTIVITY_FILTERS.trades:
      return `${TRADES_SQL} AND it.category <> :incomeCategory`;
    case PORTFOLIO_ACTIVITY_FILTERS.income:
      return `${TRADES_SQL} AND it.category = :incomeCategory`;
    case PORTFOLIO_ACTIVITY_FILTERS.cash:
      return TRANSFERS_SQL;
    default:
      return `${TRADES_SQL} UNION ALL ${TRANSFERS_SQL}`;
  }
};

interface GetPortfolioActivityParams {
  userId: number;
  portfolioId: string;
  type: PortfolioActivityFilter;
  limit: number;
  offset: number;
}

export async function getPortfolioActivity({ userId, portfolioId, type, limit, offset }: GetPortfolioActivityParams) {
  await findOrThrowNotFound({
    query: Portfolios.findOne({ where: { id: portfolioId, userId }, attributes: ['id'] }),
    message: t({ key: 'investments.portfolioNotFound' }),
  });

  const activitySql = buildActivitySql({ type });
  const replacements = { userId, portfolioId, incomeCategory: INVESTMENT_TRANSACTION_CATEGORY.dividend, limit, offset };

  const [rows, [countRow]]: [{ kind: PortfolioActivityItem['kind']; id: string }[], { totalCount: number }[]] =
    await Promise.all([
      connection.sequelize.query(
        `SELECT kind, id FROM (${activitySql}) activity
          ORDER BY "sortDate" DESC, "createdAt" DESC, id DESC
          LIMIT :limit OFFSET :offset`,
        { type: QueryTypes.SELECT, replacements },
      ),
      connection.sequelize.query(`SELECT COUNT(*)::int AS "totalCount" FROM (${activitySql}) activity`, {
        type: QueryTypes.SELECT,
        replacements,
      }),
    ]);

  const tradeIds = rows.filter((row) => row.kind === 'trade').map((row) => row.id);
  const transferIds = rows.filter((row) => row.kind === 'transfer').map((row) => row.id);

  const [trades, transfers] = await Promise.all([
    tradeIds.length
      ? InvestmentTransaction.findAll({
          where: { id: tradeIds },
          include: [
            {
              model: Securities,
              as: 'security',
              attributes: ['id', 'symbol', 'name', 'currencyCode', 'assetClass', 'logoUrl'],
            },
          ],
        })
      : [],
    transferIds.length
      ? PortfolioTransfers.findAll({ where: { id: transferIds }, include: PORTFOLIO_TRANSFER_INCLUDES })
      : [],
  ]);

  const itemsById = new Map<string, PortfolioActivityItem>([
    ...trades.map((trade) => [trade.id, { kind: 'trade', ...trade.toJSON() } as PortfolioActivityItem] as const),
    ...transfers.map(
      (transfer) => [transfer.id, { kind: 'transfer', ...transfer.toJSON() } as PortfolioActivityItem] as const,
    ),
  ]);

  return {
    data: rows.map((row) => itemsById.get(row.id)).filter((item): item is PortfolioActivityItem => !!item),
    totalCount: countRow?.totalCount ?? 0,
  };
}

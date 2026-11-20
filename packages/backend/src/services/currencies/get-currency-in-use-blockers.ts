import type { CurrencyInUseBlocker, RecordId } from '@bt/shared/types';
import * as Accounts from '@models/accounts.model';
import BudgetPlans from '@models/budget-plans.model';
import Goals from '@models/goals.model';
import Holdings from '@models/investments/holdings.model';
import InvestmentTransaction from '@models/investments/investment-transaction.model';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import Securities from '@models/investments/securities.model';
import Subscriptions from '@models/subscriptions.model';
import TransactionTemplates from '@models/transaction-templates.model';
import VentureDeals from '@models/venture/venture-deals.model';
import VentureEventLinks from '@models/venture/venture-event-links.model';
import VentureEvents from '@models/venture/venture-events.model';
import { Op } from 'sequelize';

export const getCurrencyInUseBlockers = async ({
  userId,
  currencyCode,
}: {
  userId: number;
  currencyCode: string;
}): Promise<CurrencyInUseBlocker[]> => {
  const blockers: CurrencyInUseBlocker[] = [];
  const seen = new Set<string>();
  const push = (blocker: CurrencyInUseBlocker) => {
    const key = `${blocker.type}:${blocker.id}:${blocker.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    blockers.push(blocker);
  };

  const accounts = await Accounts.getAccountsByCurrency({ userId, currencyCode });
  accounts.forEach((a) => push({ type: 'account', id: a.id, name: a.name }));

  // Trashed portfolios count too: restoring one would bring back data in a disconnected currency.
  const portfolios = await Portfolios.findAll({
    where: { userId },
    paranoid: false,
    attributes: ['id', 'name', 'displayCurrencyCode', 'deletedAt'],
  });
  const portfolioById = new Map(portfolios.map((p) => [p.id, p]));
  const portfolioIds = portfolios.map((p) => p.id);
  const pushPortfolioScoped = ({
    type,
    portfolioId,
    suffix,
  }: {
    type: CurrencyInUseBlocker['type'];
    portfolioId: RecordId | null;
    suffix?: string;
  }) => {
    const portfolio = portfolioId ? portfolioById.get(portfolioId) : undefined;
    if (!portfolio) return;
    push({
      type,
      id: portfolio.id,
      name: suffix ? `${portfolio.name}: ${suffix}` : portfolio.name,
      trashed: !!portfolio.deletedAt,
    });
  };

  portfolios
    .filter((p) => p.displayCurrencyCode === currencyCode)
    .forEach((p) => pushPortfolioScoped({ type: 'portfolio', portfolioId: p.id }));

  const holdings = await Holdings.findAll({
    where: { currencyCode, portfolioId: portfolioIds },
    attributes: ['portfolioId', 'securityId'],
    include: [{ model: Securities, attributes: ['symbol', 'name'] }],
  });
  holdings.forEach((h) =>
    pushPortfolioScoped({
      type: 'holding',
      portfolioId: h.portfolioId,
      suffix: h.security?.symbol ?? h.security?.name ?? h.securityId,
    }),
  );

  const cashBalances = await PortfolioBalances.findAll({
    where: { currencyCode, portfolioId: portfolioIds, totalCash: { [Op.ne]: 0 } },
    attributes: ['portfolioId'],
  });
  cashBalances.forEach((b) => pushPortfolioScoped({ type: 'portfolioCash', portfolioId: b.portfolioId }));

  const transfers = await PortfolioTransfers.findAll({
    where: { userId, [Op.or]: [{ currencyCode }, { toCurrencyCode: currencyCode }] },
    attributes: ['fromPortfolioId', 'toPortfolioId'],
    group: ['fromPortfolioId', 'toPortfolioId'],
  });
  transfers.forEach((tr) => {
    pushPortfolioScoped({ type: 'portfolioTransfer', portfolioId: tr.fromPortfolioId });
    pushPortfolioScoped({ type: 'portfolioTransfer', portfolioId: tr.toPortfolioId });
  });

  const investmentTransactions = await InvestmentTransaction.findAll({
    where: {
      portfolioId: portfolioIds,
      [Op.or]: [{ currencyCode }, { settlementCurrencyCode: currencyCode }],
    },
    attributes: ['portfolioId'],
    group: ['portfolioId'],
  });
  investmentTransactions.forEach((tx) =>
    pushPortfolioScoped({ type: 'investmentTransaction', portfolioId: tx.portfolioId }),
  );

  const subscriptions = await Subscriptions.findAll({
    where: { userId, expectedCurrencyCode: currencyCode },
    attributes: ['id', 'name'],
  });
  subscriptions.forEach((s) => push({ type: 'subscription', id: s.id, name: s.name }));

  const templates = await TransactionTemplates.findAll({
    where: { userId, originalCurrencyCode: currencyCode },
    attributes: ['id', 'name'],
  });
  templates.forEach((tpl) => push({ type: 'transactionTemplate', id: tpl.id, name: tpl.name }));

  const budgets = await BudgetPlans.findAll({
    where: { userId, currencyCode },
    paranoid: false,
    attributes: ['id', 'name', 'deletedAt'],
  });
  budgets.forEach((b) => push({ type: 'budget', id: b.id, name: b.name, trashed: !!b.deletedAt }));

  const goals = await Goals.findAll({ where: { userId, currencyCode }, attributes: ['id', 'name'] });
  goals.forEach((g) => push({ type: 'goal', id: g.id, name: g.name }));

  const ventureEvents = await VentureEvents.findAll({
    where: { userId, currencyCode },
    attributes: ['dealId'],
    group: ['dealId'],
  });
  const ventureLinks = await VentureEventLinks.findAll({
    where: { currencyCode },
    attributes: ['id'],
    include: [{ model: VentureEvents, where: { userId }, attributes: ['dealId'], required: true }],
  });
  const linkedDealIds = [
    ...ventureEvents.map((e) => e.dealId),
    ...ventureLinks.flatMap((l) => (l.event ? [l.event.dealId] : [])),
  ];
  const deals = await VentureDeals.findAll({
    where: { userId, [Op.or]: [{ currencyCode }, { id: linkedDealIds }] },
    paranoid: false,
    attributes: ['id', 'name', 'deletedAt'],
  });
  deals.forEach((d) => push({ type: 'ventureDeal', id: d.id, name: d.name, trashed: !!d.deletedAt }));

  return blockers;
};

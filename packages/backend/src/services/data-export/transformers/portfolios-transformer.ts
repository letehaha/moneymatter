import { getCurrencyDecimals } from '@common/lib/currency-precision';
import PortfolioBalances from '@models/investments/portfolio-balances.model';
import Portfolios from '@models/investments/portfolios.model';
import { Op } from 'sequelize';

import type { PortfolioRow } from '../types';

export async function transformPortfolios({ userId }: { userId: number }): Promise<PortfolioRow[]> {
  const portfolios = await Portfolios.findAll({ where: { userId }, order: [['name', 'ASC']] });
  if (portfolios.length === 0) return [];

  const balances = await PortfolioBalances.findAll({
    where: { portfolioId: { [Op.in]: portfolios.map((p) => p.id) } },
  });

  const balancesByPortfolio = new Map<string, PortfolioBalances[]>();
  for (const balance of balances) {
    const list = balancesByPortfolio.get(balance.portfolioId) ?? [];
    list.push(balance);
    balancesByPortfolio.set(balance.portfolioId, list);
  }

  const currencyCodes = [...new Set(balances.map((balance) => balance.currencyCode))];
  const decimalsByCurrency = new Map(
    await Promise.all(currencyCodes.map(async (code) => [code, await getCurrencyDecimals({ userId, code })] as const)),
  );

  return portfolios.map((portfolio): PortfolioRow => {
    const owned = balancesByPortfolio.get(portfolio.id);
    if (!owned || owned.length === 0) {
      return {
        name: portfolio.name,
        cashBalances: null,
        cashBalancesDetails: '',
        notes: portfolio.description ?? '',
      };
    }
    // Sort by currency code for deterministic output – same SHA-256 across
    // exports of the same data.
    const sorted = owned.toSorted((a, b) => a.currencyCode.localeCompare(b.currencyCode));
    const structured = sorted.map((b) => ({ currency: b.currencyCode, balance: b.totalCash.toNumber() }));
    const details = sorted
      .map((b) => `${b.currencyCode}: ${b.totalCash.toDecimalString(decimalsByCurrency.get(b.currencyCode)!)}`)
      .join(' | ');
    return {
      name: portfolio.name,
      cashBalances: structured,
      cashBalancesDetails: details,
      notes: portfolio.description ?? '',
    };
  });
}

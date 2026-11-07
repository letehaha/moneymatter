import type Portfolios from '@models/investments/portfolios.model';

/** A portfolio as an assistant reads it: no owner id and no audit timestamps beyond creation. */
export function presentPortfolio({ portfolio }: { portfolio: Portfolios }) {
  return {
    id: portfolio.id,
    name: portfolio.name,
    portfolioType: portfolio.portfolioType,
    description: portfolio.description,
    isEnabled: portfolio.isEnabled,
    createdAt: portfolio.createdAt,
  };
}

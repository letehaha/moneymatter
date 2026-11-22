import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';

import { findCustomCurrencyCodes } from './custom-currency-codes';
import { pegRateSourceConfigSchema } from './rate-sources';
import type { DependencyEdge } from './recompute-scope';

/**
 * The user's custom currencies that are valued through an ISO currency: pegged to it, or quoting it
 * in a stored rate. A custom currency pegged to EUR moves with the EUR rate. A peg whose saved config
 * cannot be read, and a source that is itself custom, lead nowhere.
 */
export const loadDependencyEdges = async ({ userId }: { userId: number }): Promise<DependencyEdge[]> => {
  const pegged = await UsersCurrencies.findAll({
    where: { userId, rateSource: 'peg' },
    attributes: ['currencyCode', 'rateSourceConfig'],
    raw: true,
  });
  const pegEdges = pegged.flatMap(({ currencyCode, rateSourceConfig }): DependencyEdge[] => {
    const config = pegRateSourceConfigSchema.safeParse(rateSourceConfig);

    return config.success ? [{ dependent: currencyCode, source: config.data.pegCurrency }] : [];
  });

  const quoted = await UserExchangeRates.findAll({
    where: { userId },
    attributes: ['baseCode', 'quoteCode'],
    group: ['baseCode', 'quoteCode'],
    raw: true,
  });
  const quoteEdges = quoted.map((row): DependencyEdge => ({ dependent: row.baseCode, source: row.quoteCode }));

  const edges = [...pegEdges, ...quoteEdges];
  const customCodes = await findCustomCurrencyCodes({ codes: edges.flatMap((edge) => [edge.dependent, edge.source]) });

  return edges.filter((edge) => customCodes.has(edge.dependent) && !customCodes.has(edge.source));
};

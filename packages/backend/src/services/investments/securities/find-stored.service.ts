import { SECURITY_PROVIDER } from '@bt/shared/types/investments';
import { ValidationError } from '@js/errors';
import Securities from '@models/investments/securities.model';
import { Op } from 'sequelize';

import { securityIdentityBatchWhere, securityIdentityKey } from './identity';

type SecurityShape = Parameters<typeof securityIdentityKey>[0];

/**
 * The security already stored for a provider and a symbol, or null. Read-only: unlike adding a
 * holding, it never creates a security. `symbol` is matched against the provider's own symbol
 * (what a search hit carries as `providerSymbol`) first, then against the ticker.
 */
export const findStoredSecurityBySymbol = async ({
  symbol,
  providerName,
}: {
  symbol: string;
  providerName: SECURITY_PROVIDER;
}): Promise<Securities | null> => {
  const candidates = await Securities.findAll({
    where: { providerName, [Op.or]: [{ providerSymbol: symbol }, { symbol }] },
    order: [['createdAt', 'ASC']],
  });

  const exact = candidates.filter((candidate) => candidate.providerSymbol === symbol);
  const matches = exact.length > 0 ? exact : candidates;

  if (matches.length > 1) {
    throw new ValidationError({
      message: `More than one stored security matches "${symbol}": ${matches
        .map((match) => `${match.id} (${match.currencyCode})`)
        .join(', ')}. Pass securityId instead.`,
    });
  }

  return matches[0] ?? null;
};

/**
 * For each search result, the id of the security already stored for it (same identity rule as
 * portfolio duplicate detection), or null when none is stored. The array lines up with `results`.
 */
export const findStoredSecurityIds = async ({ results }: { results: SecurityShape[] }): Promise<(string | null)[]> => {
  const where = securityIdentityBatchWhere(results);
  if (!where) return [];

  const stored = await Securities.findAll({ where, order: [['createdAt', 'ASC']] });

  // The oldest row wins when several share an identity key.
  const idByKey = new Map<string, string>();
  for (const security of stored) {
    const key = securityIdentityKey(security);
    if (!idByKey.has(key)) idByKey.set(key, security.id);
  }

  return results.map((result) => idByKey.get(securityIdentityKey(result)) ?? null);
};

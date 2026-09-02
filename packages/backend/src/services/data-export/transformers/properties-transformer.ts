import Accounts from '@models/accounts.model';
import Properties from '@models/properties.model';
import { Op } from 'sequelize';

import type { PropertyRow } from '../types';
import { resolveRelationName } from './utils';

export async function transformProperties({ userId }: { userId: number }): Promise<PropertyRow[]> {
  const properties = await Properties.findAll({ where: { userId }, order: [['createdAt', 'ASC']] });
  if (properties.length === 0) return [];

  // Cross-user guard: a stray accountId in a property row must not leak
  // another user's account name into the export. Mortgage links are resolved
  // from the same userId-scoped set, so an unowned one reads as unlinked.
  const referencedAccountIds = properties.flatMap((p) => [p.accountId, p.loanAccountId].filter((id) => id !== null));

  const accounts = await Accounts.findAll({
    where: { userId, id: { [Op.in]: referencedAccountIds } },
    attributes: ['id', 'name', 'currencyCode'],
  });
  const accountNameById = new Map(accounts.map((a) => [String(a.id), a.name]));
  const accountCurrencyById = new Map(accounts.map((a) => [String(a.id), a.currencyCode]));

  return properties.map((property): PropertyRow => {
    const accountIdStr = String(property.accountId);
    // The linked account is the source of both `linkedAccount` and the
    // `currency` column. When the FK can't be resolved (deleted account or
    // a cross-user reference dropped by the userId-scoped query above), both
    // columns must agree: linkedAccount surfaces the sentinel, currency is
    // null so a reader doesn't mistake a blank cell for "no currency set".
    const accountResolved = accountNameById.has(accountIdStr);

    return {
      address: property.address,
      propertyType: property.propertyType,
      city: property.city,
      country: property.country,
      yearBuilt: property.yearBuilt,
      linkedAccount: resolveRelationName({
        id: accountIdStr,
        nameById: accountNameById,
        relation: 'account',
        context: `property ${property.id}`,
      }),
      purchasePrice: property.purchasePrice.toNumber(),
      purchaseDate: property.purchaseDate,
      currency: accountResolved ? (accountCurrencyById.get(accountIdStr) ?? null) : null,
      annualAppreciationRatePct: Number(property.annualAppreciationRatePct),
      linkedMortgage: property.loanAccountId ? (accountNameById.get(String(property.loanAccountId)) ?? null) : null,
    };
  });
}

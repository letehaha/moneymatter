import Accounts from '@models/accounts.model';
import Properties from '@models/properties.model';
import { withTransaction } from '@services/common/with-transaction';

import { findPropertyOrThrow } from './helpers';
import { refreshPropertyValueIfStale } from './refresh-property-value.service';

interface GetPropertyParams {
  userId: number;
  propertyId: string;
}

const getPropertyImpl = async ({ userId, propertyId }: GetPropertyParams) => {
  await findPropertyOrThrow({ propertyId, userId });

  // Force-refresh on detail reads. The 30-day cache is a perf optimization for
  // the bulk account-list endpoint; the detail page is opened deliberately and
  // a single recompute is cheap. Without `force`, a backdated revaluation keeps
  // showing the anchor value instead of today's projected one until the cache
  // expires.
  await refreshPropertyValueIfStale({ propertyId, force: true });

  return Properties.findByPk(propertyId, {
    include: [
      { model: Accounts, as: 'account' },
      { model: Accounts, as: 'loanAccount' },
    ],
  });
};

export const getProperty = withTransaction(getPropertyImpl);

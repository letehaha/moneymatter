import Accounts from '@models/accounts.model';
import Properties from '@models/properties.model';
import { withTransaction } from '@services/common/with-transaction';

import { refreshStalePropertyValuesForUser } from './refresh-property-value.service';

interface GetPropertiesParams {
  userId: number;
}

const getPropertiesImpl = async ({ userId }: GetPropertiesParams) => {
  // Refresh any properties whose cache has expired so the returned values are
  // fresh in the response. Errors per-property are swallowed inside.
  await refreshStalePropertyValuesForUser({ userId });

  return Properties.findAll({
    where: { userId },
    include: [
      { model: Accounts, as: 'account' },
      { model: Accounts, as: 'loanAccount' },
    ],
    order: [['createdAt', 'DESC']],
  });
};

export const getProperties = withTransaction(getPropertiesImpl);

import { PROPERTY_TYPE } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import Properties from '@models/properties.model';
import { withTransaction } from '@services/common/with-transaction';

import { assertLinkableLoanAccount, findPropertyOrThrow } from './helpers';
import { refreshPropertyValueIfStale } from './refresh-property-value.service';

interface UpdatePropertyParams {
  userId: number;
  propertyId: string;
  name?: string;
  address?: string;
  city?: string | null;
  country?: string | null;
  propertyType?: PROPERTY_TYPE;
  yearBuilt?: number | null;
  notes?: string | null;
  annualAppreciationRatePct?: number;
  loanAccountId?: string | null;
}

const updatePropertyImpl = async (params: UpdatePropertyParams) => {
  const { userId, propertyId, name, ...rest } = params;

  const property = await findPropertyOrThrow({ propertyId, userId });

  if (rest.loanAccountId !== undefined) {
    await assertLinkableLoanAccount({ userId, loanAccountId: rest.loanAccountId });
  }

  const rateChanged =
    rest.annualAppreciationRatePct !== undefined &&
    rest.annualAppreciationRatePct !== Number(property.annualAppreciationRatePct);

  await property.update(rest);

  if (name !== undefined) {
    await Accounts.update({ name }, { where: { id: property.accountId, userId } });
  }

  // Only the rate feeds the projection; address/notes/type are metadata, so
  // leave the cache alone for those and avoid a pointless Balances write.
  if (rateChanged) {
    await refreshPropertyValueIfStale({ propertyId, force: true });
  }

  return Properties.findByPk(propertyId, {
    include: [
      { model: Accounts, as: 'account' },
      { model: Accounts, as: 'loanAccount' },
    ],
  });
};

export const updateProperty = withTransaction(updatePropertyImpl);

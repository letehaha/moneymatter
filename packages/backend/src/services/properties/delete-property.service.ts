import { deleteAccountById } from '@services/accounts.service';
import { withTransaction } from '@services/common/with-transaction';

import { findPropertyOrThrow } from './helpers';

interface DeletePropertyParams {
  userId: number;
  propertyId: string;
}

const deletePropertyImpl = async ({ userId, propertyId }: DeletePropertyParams) => {
  const property = await findPropertyOrThrow({ propertyId, userId, attributes: ['accountId'] });

  // Delegate to the accounts service so share cleanup, cross-user transfer
  // conversion, and post-commit notification fan-out all run. The Properties row
  // is removed via FK ON DELETE CASCADE from Accounts.
  await deleteAccountById({ id: property.accountId, userId });

  return { id: propertyId };
};

export const deleteProperty = withTransaction(deletePropertyImpl);

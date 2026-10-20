import type { EntityLogoPayload } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import AccountGroup from '@models/accounts-groups/account-groups.model';
import { applyManualLogoPatch } from '@services/brand-logos';

import { withTransaction } from '../common/with-transaction';

export const createAccountGroup = withTransaction(
  async ({
    userId,
    name,
    parentGroupId,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
  }: {
    userId: number;
    name: string;
    parentGroupId?: string | null;
  } & EntityLogoPayload): Promise<AccountGroup> => {
    if (parentGroupId) {
      await findOrThrowNotFound({
        query: AccountGroup.findOne({ where: { id: parentGroupId, userId } }),
        message: t({ key: 'accountGroups.parentGroupDoesNotExist' }),
      });
    }

    return AccountGroup.create({
      userId,
      name,
      parentGroupId,
      ...applyManualLogoPatch({
        patch: { logoDomain, logoInitials, logoColor, logoIcon },
      }),
    });
  },
);

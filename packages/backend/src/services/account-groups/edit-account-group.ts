import type { EntityLogoPayload } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { UnexpectedError } from '@js/errors';
import AccountGroup from '@models/accounts-groups/account-groups.model';
import { assertValidParentGroup } from '@services/account-groups/assert-valid-parent-group';
import { applyManualLogoPatch } from '@services/brand-logos';

import { withTransaction } from '../common/with-transaction';

export const updateAccountGroup = withTransaction(
  async ({
    groupId,
    userId,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    ...updates
  }: {
    groupId: string;
    userId: number;
  } & Partial<Pick<AccountGroup, 'name' | 'parentGroupId'>> &
    EntityLogoPayload): Promise<AccountGroup> => {
    const group = await findOrThrowNotFound({
      query: AccountGroup.findOne({ where: { id: groupId, userId } }),
      message: t({ key: 'accountGroups.groupNotFound' }),
    });

    if (updates.parentGroupId) {
      await assertValidParentGroup({ groupId, parentGroupId: updates.parentGroupId, userId });
    }

    const logoPatch = applyManualLogoPatch({
      patch: { logoDomain, logoInitials, logoColor, logoIcon },
      stored: group,
    });

    const patch = { ...updates, ...logoPatch };

    // Sequelize short-circuits an empty update to `[0]` with no rows element,
    // so a payload with nothing to write must return the stored group itself.
    if (!Object.values(patch).some((value) => value !== undefined)) {
      return group;
    }

    const [, [updatedGroup]] = await AccountGroup.update(patch, {
      where: { id: groupId, userId },
      returning: true,
    });

    // The row was found moments ago in this transaction, so an empty returning
    // set means it vanished concurrently – never a successful update.
    if (!updatedGroup) {
      throw new UnexpectedError({ message: t({ key: 'accountGroups.groupUpdateFailed' }) });
    }

    return updatedGroup;
  },
);

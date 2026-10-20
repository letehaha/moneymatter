import { RESOURCE_TYPES, SHARE_PERMISSIONS } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import AccountGrouping from '@models/accounts-groups/account-grouping.model';
import AccountGroup from '@models/accounts-groups/account-groups.model';
import { canUserAccessResource } from '@services/sharing/auth/can-user-access-resource.service';
import { Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';

export const addAccountToGroup = withTransaction(
  async ({
    accountId,
    groupId,
    userId,
  }: {
    accountId: string;
    groupId: string;
    userId: number;
  }): Promise<AccountGrouping> => {
    // Grouping is the caller's personal sidebar organization, not a write on the account
    // itself — a `read` recipient may organize a shared account into their own group.
    const access = await canUserAccessResource({
      userId,
      resourceType: RESOURCE_TYPES.account,
      resourceId: accountId,
      requiredPermission: SHARE_PERMISSIONS.read,
    });
    if (!access.granted) {
      throw new NotFoundError({
        message: t({ key: 'accountGroups.accountNotFound' }),
      });
    }

    await findOrThrowNotFound({
      query: AccountGroup.findOne({ where: { id: groupId, userId } }),
      message: t({ key: 'accountGroups.accountGroupNotFound' }),
    });

    // Scope the "single group per account" rule per-user: only drop existing groupings
    // whose group belongs to the caller. Owner's grouping rows (different `userId` on
    // `AccountGroup`) are untouched so each side organizes their account list independently.
    const callerGroups = (await AccountGroup.findAll({
      where: { userId },
      attributes: ['id'],
      raw: true,
    })) as unknown as { id: string }[];
    const callerGroupIds = callerGroups.map((g) => g.id);

    if (callerGroupIds.length > 0) {
      await AccountGrouping.destroy({
        where: { accountId, groupId: { [Op.in]: callerGroupIds } },
      });
    }

    return AccountGrouping.create({ accountId, groupId });
  },
);

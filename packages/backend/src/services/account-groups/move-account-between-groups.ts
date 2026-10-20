import AccountGroup from '@models/accounts-groups/account-groups.model';
import { assertValidParentGroup } from '@services/account-groups/assert-valid-parent-group';

import { withTransaction } from '../common/with-transaction';

export const moveAccountGroup = withTransaction(
  async ({
    groupId,
    newParentGroupId,
    userId,
  }: {
    groupId: string;
    newParentGroupId: string | null;
    userId: number;
  }): Promise<[number, AccountGroup[]]> => {
    if (newParentGroupId !== null) {
      await assertValidParentGroup({ groupId, parentGroupId: newParentGroupId, userId });
    }

    return AccountGroup.update(
      { parentGroupId: newParentGroupId },
      { where: { id: groupId, userId }, returning: true },
    );
  },
);

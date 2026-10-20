import AccountGrouping from '@models/accounts-groups/account-grouping.model';
import AccountGroup from '@models/accounts-groups/account-groups.model';
import { removeAccountFromGroup } from '@services/account-groups/remove-account-from-group';
import { pauseAutomationsReferencing } from '@services/transaction-automations/references';

import { withTransaction } from '../common/with-transaction';

export const deleteAccountGroup = withTransaction(
  async ({ groupId, userId }: { groupId: string; userId: number }): Promise<void> => {
    const group = await AccountGroup.findOne({ where: { id: groupId, userId } });

    if (!group) return;

    const groupAccountMappings = await AccountGrouping.findAll({
      where: { groupId },
      include: [{ model: AccountGroup, as: 'group' }],
    });

    if (groupAccountMappings.length > 0) {
      const accountIds = groupAccountMappings.map((mapping) => mapping.accountId);
      await removeAccountFromGroup({ accountIds, groupId, userId });
    }

    await pauseAutomationsReferencing({ userId, refType: 'accountGroup', refId: group.id, label: group.name });

    const newParentGroupId = group.parentGroupId === group.id ? null : group.parentGroupId;
    await AccountGroup.update({ parentGroupId: newParentGroupId }, { where: { parentGroupId: group.id, userId } });

    await group.destroy();
  },
);

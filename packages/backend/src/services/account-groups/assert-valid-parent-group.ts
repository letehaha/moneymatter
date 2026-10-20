import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import AccountGroup from '@models/accounts-groups/account-groups.model';

export const assertValidParentGroup = async ({
  groupId,
  parentGroupId,
  userId,
}: {
  groupId: string;
  parentGroupId: string;
  userId: number;
}): Promise<void> => {
  const groups = await AccountGroup.findAll({ where: { userId }, attributes: ['id', 'parentGroupId'] });
  const parentIdById = new Map<string, string | null>(groups.map((group) => [group.id, group.parentGroupId]));

  if (!parentIdById.has(parentGroupId)) {
    throw new NotFoundError({ message: t({ key: 'accountGroups.parentGroupNotExist' }) });
  }

  // `visited` stops the walk on cyclic data that already exists in the DB.
  const visited = new Set<string>();
  for (let id: string | null = parentGroupId; id && !visited.has(id); id = parentIdById.get(id) ?? null) {
    if (id === groupId) {
      throw new ValidationError({ message: t({ key: 'accountGroups.parentGroupCycle' }) });
    }
    visited.add(id);
  }
};

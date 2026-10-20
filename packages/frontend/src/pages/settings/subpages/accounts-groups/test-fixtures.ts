import type { AccountGroups } from '@/common/types/models';
import type { AccountModel } from '@bt/shared/types';

export const makeGroup = ({
  id,
  name = id,
  parentGroupId = null,
  bankDataProviderConnectionId = null,
  accounts = [],
  childGroups = [],
}: {
  id: string;
  name?: string;
  parentGroupId?: string | null;
  bankDataProviderConnectionId?: string | null;
  accounts?: AccountModel[];
  childGroups?: AccountGroups[];
}) =>
  ({
    id,
    name,
    parentGroupId,
    bankDataProviderConnectionId,
    accounts,
    childGroups,
  }) as unknown as AccountGroups;

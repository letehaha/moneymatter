import type { AccountGroupPathEntry } from '@/components/sidebar/accounts-view/helpers/list-account-group-paths';
import { ACCOUNT_STATUSES, type AccountModel } from '@bt/shared/types';

interface AccountInOtherGroup {
  account: AccountModel;
  groupId: string;
  groupName: string;
  path: string;
}

interface AddAccountsSections {
  ungrouped: AccountModel[];
  inOtherGroups: AccountInOtherGroup[];
  alreadyInGroup: AccountModel[];
}

export const buildAddAccountsSections = ({
  accounts,
  entries,
  groupId,
}: {
  accounts: AccountModel[];
  entries: AccountGroupPathEntry[];
  groupId: string;
}): AddAccountsSections => {
  const membership = new Map<string, AccountGroupPathEntry>();
  for (const entry of entries) {
    for (const account of entry.group.accounts) membership.set(account.id, entry);
  }

  const sections: AddAccountsSections = { ungrouped: [], inOtherGroups: [], alreadyInGroup: [] };

  for (const account of accounts) {
    if (account.status !== ACCOUNT_STATUSES.active) continue;

    const entry = membership.get(account.id);
    if (!entry) sections.ungrouped.push(account);
    else if (entry.group.id === groupId) sections.alreadyInGroup.push(account);
    else
      sections.inOtherGroups.push({ account, groupId: entry.group.id, groupName: entry.group.name, path: entry.path });
  }

  return sections;
};

export const filterAddAccountsSections = ({
  sections,
  query,
}: {
  sections: AddAccountsSections;
  query: string;
}): AddAccountsSections => {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;

  const matches = ({ name }: AccountModel) => name.toLowerCase().includes(needle);
  return {
    ungrouped: sections.ungrouped.filter(matches),
    inOtherGroups: sections.inOtherGroups.filter(({ account }) => matches(account)),
    alreadyInGroup: sections.alreadyInGroup.filter(matches),
  };
};

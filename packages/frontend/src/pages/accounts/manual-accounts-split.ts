import type { AccountGroups } from '@/common/types/models';
import { buildAccountGroupTree } from '@/components/sidebar/accounts-view/helpers/build-account-group-tree';
import type { AccountModel } from '@bt/shared/types';

const isBankLinked = (account: AccountModel): boolean => account.bankDataProviderConnectionId != null;

/**
 * Strip bank-linked accounts from a group tree and drop groups whose subtree ends up
 * empty. Bank-linked accounts render under their connection in the Bank connections
 * section, so the Manual section must not show them a second time.
 */
export const pruneBankLinkedAccounts = ({ groups }: { groups: AccountGroups[] }): AccountGroups[] =>
  groups
    .map((group) => ({
      ...group,
      accounts: group.accounts.filter((account) => !isBankLinked(account)),
      childGroups: pruneBankLinkedAccounts({ groups: group.childGroups }),
    }))
    .filter((group) => group.accounts.length > 0 || group.childGroups.length > 0);

/**
 * Manual accounts sitting anywhere inside the given group subtrees. Used to rescue
 * manual accounts a user placed into a connection-managed group — that group isn't
 * rendered in the Manual section, so its manual accounts resurface as loose rows.
 */
export const collectManualAccounts = ({ groups }: { groups: AccountGroups[] }): AccountModel[] =>
  groups.flatMap((group) => [
    ...group.accounts.filter((account) => !isBankLinked(account)),
    ...collectManualAccounts({ groups: group.childGroups }),
  ]);

/**
 * Map account id → name of the folder group it sits in directly. Connection-managed
 * groups are skipped: "in Monobank" under the Monobank connection row is noise, while
 * "in Credit cards" tells the user their own organization is still honored.
 */
export const mapFolderGroupNames = ({ groups }: { groups: AccountGroups[] }): Record<string, string> => {
  const names: Record<string, string> = {};

  const walk = (list: AccountGroups[]): void => {
    for (const group of list) {
      if (group.bankDataProviderConnectionId == null) {
        for (const account of group.accounts) names[account.id] = group.name;
      }
      walk(group.childGroups);
    }
  };

  walk(groups);
  return names;
};

/**
 * Split the flat `/account-group` list into what the Manual section renders: the nested folder-group
 * tree (root groups only, each carrying its hydrated subgroups, stripped of bank-linked accounts)
 * and the loose manual accounts rescued from connection-managed groups and their subgroups.
 */
export const buildManualFolderGroups = ({
  groups,
}: {
  groups: AccountGroups[];
}): { folderGroups: AccountGroups[]; rescuedAccounts: AccountModel[] } => {
  const roots = buildAccountGroupTree({ groups });
  const isConnectionGroup = (group: AccountGroups): boolean => group.bankDataProviderConnectionId != null;

  return {
    folderGroups: pruneBankLinkedAccounts({ groups: roots.filter((group) => !isConnectionGroup(group)) }),
    rescuedAccounts: collectManualAccounts({ groups: roots.filter(isConnectionGroup) }),
  };
};

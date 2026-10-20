import type { AccountGroups } from '@/common/types/models';
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

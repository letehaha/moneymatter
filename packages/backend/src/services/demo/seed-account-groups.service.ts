import { logger } from '@js/utils/logger';
import Accounts from '@models/accounts.model';
import { addAccountToGroup } from '@services/account-groups/add-account-to-group';
import { createAccountGroup } from '@services/account-groups/create-account-group';

import { DEMO_CONFIG, type DemoAccountKey } from './demo-config';

/**
 * Account groups for the demo user.
 *
 * Only cash accounts are grouped. Vehicle and loan accounts are backed by
 * accounts but presented as their own entities (Vehicles section, `/loans`
 * page), and the accounts UI filters them out of the manual account list — a
 * group holding them would render as an empty row.
 */
export const DEMO_ACCOUNT_GROUPS: {
  name: string;
  accountKeys: DemoAccountKey[];
  logoInitials: string;
  logoColor: string;
}[] = [
  { name: 'Day-to-day', accountKeys: ['main_checking', 'cash'], logoInitials: 'DD', logoColor: '#0ea5e9' },
  { name: 'Travel', accountKeys: ['travel_card'], logoInitials: 'TR', logoColor: '#f59e0b' },
  { name: 'Savings & Goals', accountKeys: ['savings'], logoInitials: 'SG', logoColor: '#22c55e' },
];

export async function setupAccountGroups({ userId }: { userId: number }): Promise<Map<string, string>> {
  const accounts = await Accounts.findAll({
    where: { userId },
    attributes: ['id', 'name'],
  });

  // The DB rows carry display names; the config addresses accounts by key.
  const nameByAccountKey = new Map<DemoAccountKey, string>(
    DEMO_CONFIG.accounts.map((account) => [account.key, account.name]),
  );

  let groupedCount = 0;
  const groupIdByName = new Map<string, string>();

  for (const groupConfig of DEMO_ACCOUNT_GROUPS) {
    const names = new Set(groupConfig.accountKeys.map((key) => nameByAccountKey.get(key)));
    const members = accounts.filter((account) => names.has(account.name));

    if (!members.length) continue;

    const group = await createAccountGroup({
      userId,
      name: groupConfig.name,
      logoInitials: groupConfig.logoInitials,
      logoColor: groupConfig.logoColor,
    });
    groupIdByName.set(group.name, group.id);

    for (const account of members) {
      await addAccountToGroup({ userId, accountId: account.id, groupId: group.id });
      groupedCount += 1;
    }
  }

  logger.info(`Created demo account groups (${groupedCount} accounts grouped) for user ${userId}`);

  return groupIdByName;
}

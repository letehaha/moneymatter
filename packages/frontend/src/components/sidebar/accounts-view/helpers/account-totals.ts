import type { AccountGroups } from '@/common/types/models';
import { computeAccountDisplayBalances } from '@/common/utils/account-balance';
import { AccountModel } from '@bt/shared/types';

/**
 * The only fields a base-currency roll-up reads. Kept minimal so both `AccountModel`
 * and the API's `LoanApi`/`AccountApiResponse` shapes satisfy it.
 */
export interface BalanceAccount {
  currentBalance: number;
  refCurrentBalance: number;
  creditLimit: number;
  refCreditLimit: number;
  currencyCode: string;
}

export interface GroupBaseTotal {
  /** Summed balance in the user's base currency. */
  total: number;
  /** True when any account sits in a non-base currency, so the total rolls up converted figures. */
  isApprox: boolean;
}

/**
 * Base-currency balance of a single account, run through the shared credit-limit
 * adjustment so a group total lines up with the balances shown on its rows.
 */
const accountBaseBalance = ({
  account,
  includeCreditLimit,
}: {
  account: BalanceAccount;
  includeCreditLimit: boolean;
}): number =>
  computeAccountDisplayBalances({
    currentBalance: account.currentBalance,
    refCurrentBalance: account.refCurrentBalance,
    creditLimit: account.creditLimit,
    refCreditLimit: account.refCreditLimit,
    includeCreditLimit,
  }).displayRefBalance;

/**
 * Sum a set of accounts into a single base-currency total, flagging whether any
 * member was converted from another currency (drives the "≈" prefix on the total).
 */
export const sumAccountsBaseBalance = ({
  accounts,
  baseCurrencyCode,
  includeCreditLimit,
}: {
  accounts: BalanceAccount[];
  baseCurrencyCode: string | undefined;
  includeCreditLimit: boolean;
}): GroupBaseTotal => {
  let total = 0;
  let isApprox = false;

  for (const account of accounts) {
    total += accountBaseBalance({ account, includeCreditLimit });
    if (baseCurrencyCode && account.currencyCode !== baseCurrencyCode) isApprox = true;
  }

  return { total, isApprox };
};

/** Every account under the given groups and their descendants, keyed by account id. */
export const flattenAccounts = ({ groups }: { groups: AccountGroups[] }): Record<string, AccountModel> =>
  groups.reduce(
    (acc, group) => {
      group.accounts.forEach((account) => {
        acc[account.id] = account;
      });
      if (group.childGroups.length) {
        Object.assign(acc, flattenAccounts({ groups: group.childGroups }));
      }
      return acc;
    },
    {} as Record<string, AccountModel>,
  );

/** Flatten a group's own accounts plus every descendant group's accounts. */
export const collectGroupAccounts = ({ group }: { group: AccountGroups }): AccountModel[] => {
  const accounts = [...group.accounts];
  for (const child of group.childGroups) {
    accounts.push(...collectGroupAccounts({ group: child }));
  }
  return accounts;
};

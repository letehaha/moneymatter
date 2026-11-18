import { type AccountMappingConfig, type AccountModel, type AccountOption, AccountOptionValue } from '@bt/shared/types';

const isSeamAccount = ({ account }: { account: AccountModel | undefined }) => !!account?.bankSeamAt;
const toSeamAccounts = ({ accounts }: { accounts: (AccountModel | undefined)[] }) =>
  accounts.filter((account): account is AccountModel => isSeamAccount({ account }));

/** The CSV importer alone may also target a bank-linked account that has a seam. */
export const getCsvTargetableAccounts = ({
  importLinkableAccounts,
  accounts,
}: {
  importLinkableAccounts: AccountModel[];
  accounts: AccountModel[];
}): AccountModel[] => [...importLinkableAccounts, ...toSeamAccounts({ accounts })];

/** Seam accounts the import writes to, and whether every target is one. Skipped source accounts are not targets. */
export const getCsvSeamTargets = ({
  account,
  accountMapping,
  accountsRecord,
}: {
  account: AccountOption | null;
  accountMapping: AccountMappingConfig;
  accountsRecord: Record<string, AccountModel | undefined>;
}): { seamAccounts: AccountModel[]; isEveryTargetSeam: boolean } => {
  const targetIds =
    account?.option === AccountOptionValue.existingAccount
      ? [account.accountId]
      : Object.values(accountMapping).flatMap((value) => {
          if (value.action === 'skip') return [];
          return [value.action === 'link-existing' ? value.accountId : null];
        });
  const targets = targetIds.map((id) => (id ? accountsRecord[id] : undefined));
  const seamAccounts = [...new Map(toSeamAccounts({ accounts: targets }).map((item) => [item.id, item])).values()];

  return {
    seamAccounts,
    isEveryTargetSeam: targets.length > 0 && targets.every((target) => isSeamAccount({ account: target })),
  };
};

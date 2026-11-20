import { formatBankSeamDay } from '@/common/utils/bank-row-permissions';
import { type AccountMappingConfig, type AccountModel, type AccountOption, AccountOptionValue } from '@bt/shared/types';
import type { ComposerTranslation } from 'vue-i18n';

const isSeamAccount = ({ account }: { account: AccountModel | null | undefined }) => !!account?.bankSeamAt;
const toSeamAccounts = ({ accounts }: { accounts: (AccountModel | null | undefined)[] }) =>
  accounts.filter((account): account is AccountModel => isSeamAccount({ account }));

export type LinkedAccountMapping = Record<
  string,
  { action: 'link-existing'; accountId: string | undefined } | { action: 'create-new' | 'skip' }
>;

/** Existing accounts an import's account mapping links to. */
export const getLinkedAccounts = ({
  accountMapping,
  accountsRecord,
}: {
  accountMapping: LinkedAccountMapping;
  accountsRecord: Record<string, AccountModel | undefined>;
}): (AccountModel | undefined)[] =>
  Object.values(accountMapping).map((value) =>
    value.action === 'link-existing' && value.accountId ? accountsRecord[value.accountId] : undefined,
  );

/** The seam day is named only when it is unambiguous: a single seam account among the targets. */
export const getBankSeamSkippedMessage = ({
  count,
  accounts,
  t,
}: {
  count: number;
  accounts: (AccountModel | null | undefined)[];
  t: ComposerTranslation;
}): string => {
  const [seamAccount, ...others] = new Map(toSeamAccounts({ accounts }).map((item) => [item.id, item])).values();
  if (seamAccount?.bankSeamAt && others.length === 0) {
    const date = formatBankSeamDay({ seamAt: seamAccount.bankSeamAt });
    return t('importShared.bankSeamSkipped', { count, date }, count);
  }
  return t('importShared.bankSeamSkippedNoDate', { count }, count);
};

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

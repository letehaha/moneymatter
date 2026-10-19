import { ACCOUNT_CATEGORIES, type AccountWithRelinkStatus, type RecordId } from '@bt/shared/types';

/**
 * True only for a genuine orphan: an account of a sidecar-owning category still
 * in the live list but missing its sidecar record. A ghost id (already dropped
 * from the live list, e.g. a just-deleted vehicle or property) legitimately has
 * no record and returns false.
 */
export const isGenuineSidecarOrphan = ({
  accountId,
  category,
  liveAccounts,
  sidecarRecords,
}: {
  accountId: RecordId | undefined;
  category: ACCOUNT_CATEGORIES;
  liveAccounts: Pick<AccountWithRelinkStatus, 'id' | 'accountCategory'>[];
  sidecarRecords: { accountId: RecordId }[];
}): boolean => {
  if (!accountId) return false;
  const account = liveAccounts.find((item) => item.id === accountId);
  if (!account) return false;
  if (account.accountCategory !== category) return false;
  return !sidecarRecords.some((record) => record.accountId === accountId);
};

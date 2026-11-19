import { ACCOUNT_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { getSeamStart, type SeamAccount } from '@services/accounts/seam';

/**
 * A bank-linked account's balance is owned by the provider sync. Imported rows and
 * the opening-balance absorb would desync it, and undo refuses such accounts.
 * `allowSeam` lets an importer that splits its rows at the bank seam target an account
 * that has one: its rows before the seam are the user's own history.
 */
export function assertImportTargetNotBankLinked({
  account,
  allowSeam = false,
}: {
  account: SeamAccount & { name: string; type: ACCOUNT_TYPES };
  allowSeam?: boolean;
}): void {
  if (account.type === ACCOUNT_TYPES.system || (allowSeam && getSeamStart({ account }))) return;

  throw new ValidationError({
    message: t({ key: 'importExport.importIntoBankLinkedAccount', variables: { accountName: account.name } }),
  });
}

import { ACCOUNT_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

/**
 * A bank-linked account's balance is owned by the provider sync. Imported rows and
 * the opening-balance absorb would desync it, and undo refuses such accounts.
 */
export function assertImportTargetNotBankLinked({ account }: { account: { name: string; type: ACCOUNT_TYPES } }): void {
  if (account.type !== ACCOUNT_TYPES.system) {
    throw new ValidationError({
      message: t({ key: 'importExport.importIntoBankLinkedAccount', variables: { accountName: account.name } }),
    });
  }
}

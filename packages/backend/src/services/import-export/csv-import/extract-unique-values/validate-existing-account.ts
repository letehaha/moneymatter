import { AccountOptionValue, type ColumnMappingConfig } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import * as Accounts from '@models/accounts.model';

interface ValidateExistingAccountParams {
  userId: number;
  columnMapping: ColumnMappingConfig;
}

/**
 * Validates that the selected existing account belongs to the user
 */
export async function validateExistingAccount({ userId, columnMapping }: ValidateExistingAccountParams): Promise<void> {
  const accountOption = columnMapping.account;

  if (accountOption.option === AccountOptionValue.existingAccount) {
    await findOrThrowNotFound({
      query: Accounts.getAccountById({
        userId,
        id: accountOption.accountId,
      }),
      message: t({ key: 'csvImport.selectedAccountNotFound' }),
    });
  }
}

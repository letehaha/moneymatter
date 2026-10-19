import type { ImportError, ImportJobFailure, ImportJobFailureCode, ImportRowErrorCode } from '@bt/shared/types';
import type { ComposerTranslation } from 'vue-i18n';

const ROW_ERROR_KEYS: Record<ImportRowErrorCode, string> = {
  'payee-default-tags-failed': 'pages.importExport.importResults.rowErrors.payeeDefaultTagsFailed',
  'account-unresolved': 'pages.importExport.importResults.rowErrors.accountUnresolved',
  'read-back-failed': 'pages.importExport.importResults.rowErrors.readBackFailed',
};

const JOB_FAILURE_KEYS: Record<ImportJobFailureCode, string> = {
  interrupted: 'pages.importExport.jobFailure.interrupted',
  'base-currency-change-in-progress': 'pages.importExport.jobFailure.baseCurrencyChangeInProgress',
  'account-currency-mismatch': 'pages.importExport.jobFailure.accountCurrencyMismatch',
  'category-name-too-long': 'pages.importExport.jobFailure.categoryNameTooLong',
  'payee-name-too-long': 'pages.importExport.jobFailure.payeeNameTooLong',
  'account-mapping-missing': 'pages.importExport.jobFailure.accountMappingMissing',
  'linked-account-not-found': 'pages.importExport.jobFailure.linkedAccountNotFound',
};

/** Translated text for an import summary error. The server's English `error` is never shown. */
export const importErrorMessage = ({ error, t }: { error: ImportError; t: ComposerTranslation }): string => {
  if (error.code === 'account-balance-desync') {
    if (!error.accountName) return t('pages.importExport.balanceDesync.unnamedAccount');
    return t(
      error.accountCreated
        ? 'pages.importExport.balanceDesync.createdAccount'
        : 'pages.importExport.balanceDesync.linkedAccount',
      { account: error.accountName },
    );
  }
  const key = error.code ? ROW_ERROR_KEYS[error.code as ImportRowErrorCode] : undefined;
  return t(key ?? 'pages.importExport.importResults.rowErrors.generic');
};

/** Translated detail for a failed import job, or `null` when the code is missing or unknown. */
export const importJobFailureMessage = ({
  failure,
  t,
}: {
  failure: ImportJobFailure | undefined;
  t: ComposerTranslation;
}): string | null => {
  const key = failure ? JOB_FAILURE_KEYS[failure.code] : undefined;
  return key ? t(key, failure?.params ?? {}) : null;
};

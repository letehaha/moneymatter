import { useAccountsStore } from '@/stores';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';

/** Accounts the caller can't see (e.g. another member's) render as a generic label. */
export const useAccountName = () => {
  const { t } = useI18n();
  const { accountsRecord } = storeToRefs(useAccountsStore());

  return ({ accountId }: { accountId: string | undefined }): string =>
    (accountId && accountsRecord.value[accountId]?.name) || t('common.transactions.record.hiddenAccount');
};

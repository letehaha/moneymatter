<script setup lang="ts">
import { getAccountTransactionCount } from '@/api';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import AlertDialog from '@/components/common/alert-dialog.vue';
import ClickToCopy from '@/components/common/click-to-copy.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { useNotificationCenter } from '@/components/notification-center';
import { isApiErrorWithCode } from '@/js/errors';
import { ROUTES_NAMES } from '@/routes';
import { useAccountsStore } from '@/stores';
import { AccountModel, API_ERROR_CODES } from '@bt/shared/types';
import { Trash2Icon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const props = defineProps<{
  account: AccountModel;
}>();
const router = useRouter();

const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const accountsStore = useAccountsStore();
const { t } = useI18n();
const confirmAccountName = ref('');
const removePortfolioTransfers = ref(true);
const accountId = toRef(() => props.account.id);

const wasDialogOpened = ref(false);
const { data: transactionCountData, isLoading: isTransactionCountLoading } = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.accountTransactionCount, accountId],
  queryFn: () => getAccountTransactionCount({ id: accountId.value }),
  enabled: wasDialogOpened,
});

const transactionCount = computed(() => transactionCountData.value?.transactionCount);

const deleteAccount = async () => {
  const accountName = props.account.name;

  if (confirmAccountName.value !== accountName) return;
  try {
    await accountsStore.deleteAccount({
      id: props.account.id,
      removePortfolioTransfers: removePortfolioTransfers.value,
    });
    addSuccessNotification(t('pages.account.deletion.success', { accountName }));
    router.push({ name: ROUTES_NAMES.accounts });
  } catch (e) {
    // Surface the backend message verbatim for validation errors (e.g. "delete
    // blocked — loan payments exist") — already localised.
    if (isApiErrorWithCode(e, API_ERROR_CODES.validationError) && e.data?.message) {
      addErrorNotification(e.data.message);
    } else {
      addErrorNotification(t('pages.account.deletion.error'));
    }
  }
};
</script>

<template>
  <div class="border-destructive @container/danger-zone mt-4 grid gap-4 rounded-xl border p-4 sm:-mx-4">
    <p class="text-lg font-medium">{{ t('pages.account.deletion.dangerZone') }}</p>

    <div class="flex flex-col justify-between gap-2 @[400px]/danger-zone:flex-row @[400px]/danger-zone:items-center">
      <div>
        <p class="mb-2 font-bold">{{ t('pages.account.deletion.title') }}</p>
        <p class="text-xs">
          {{ t('pages.account.deletion.description') }} <br />
          <b>{{ t('pages.account.deletion.transactionsWarning') }}</b>
          {{ t('pages.account.deletion.certaintyWarning') }}
        </p>
      </div>

      <AlertDialog
        :title="t('pages.account.deletion.confirmTitle')"
        :accept-disabled="confirmAccountName !== account.name || isTransactionCountLoading"
        accept-variant="destructive"
        @accept="deleteAccount"
      >
        <template #trigger>
          <Button variant="destructive" @click="wasDialogOpened = true">
            <Trash2Icon class="size-4" /> {{ t('pages.account.deletion.deleteButton') }}
          </Button>
        </template>
        <template #description>
          <template v-if="transactionCount === undefined">
            {{ t('pages.account.deletion.cannotUndo') }} {{ t('pages.account.deletion.deleteConfirm') }}
          </template>
          <template v-else-if="transactionCount > 0">
            {{ t('pages.account.deletion.cannotUndo') }}
            <strong>
              {{ t('pages.account.deletion.transactionCount', { count: transactionCount }) }}
            </strong>
            {{ t('pages.account.deletion.deleteConfirm') }}
          </template>
          <template v-else>
            {{ t('pages.account.deletion.cannotUndo') }} {{ t('pages.account.deletion.deleteConfirm') }}
            <strong> {{ t('pages.account.deletion.noTransactions') }} </strong>
          </template>
        </template>
        <template #content>
          <div class="mb-3">
            <p class="text-muted-foreground mb-1 text-xs">{{ t('pages.account.deletion.accountNameLabel') }}</p>
            <ClickToCopy :value="account.name" />
          </div>

          <InputField
            v-model="confirmAccountName"
            :placeholder="$t('pages.account.deletion.confirmPlaceholder')"
            class="border-destructive focus-visible:outline-destructive"
          />

          <label class="mt-3 flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox v-model="removePortfolioTransfers" class="mt-0.5" />
            {{ t('pages.account.deletion.removePortfolioTransfers') }}
          </label>
        </template>
      </AlertDialog>
    </div>
  </div>
</template>

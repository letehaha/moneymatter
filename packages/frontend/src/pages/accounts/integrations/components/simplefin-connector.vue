<template>
  <div class="space-y-4">
    <!-- Step 1: Enter Setup Token -->
    <template v-if="currentStep === 1">
      <div class="space-y-4">
        <Callout>
          <ResponsivePopover
            :title="t('pages.integrations.simplefin.brokerageNotice.title')"
            align="start"
            content-class="w-90 max-w-[calc(100vw-2rem)]"
          >
            <template #trigger>
              <UiButton variant="link" class="inline h-auto p-0 text-left font-medium whitespace-normal text-inherit">
                {{ t('pages.integrations.simplefin.brokerageNotice.trigger')
                }}<InfoIcon class="ml-1 inline size-4 align-text-bottom" />
              </UiButton>
            </template>

            <h3 class="mb-2 font-semibold">{{ t('pages.integrations.simplefin.brokerageNotice.title') }}</h3>
            <div class="text-muted-foreground space-y-2 text-sm">
              <p>{{ t('pages.integrations.simplefin.brokerageNotice.supported') }}</p>
              <p>{{ t('pages.integrations.simplefin.brokerageNotice.unsupported') }}</p>
              <p>{{ t('pages.integrations.simplefin.brokerageNotice.tryAnyway') }}</p>
            </div>
          </ResponsivePopover>
        </Callout>

        <div>
          <InputField
            v-model="setupToken"
            :label="t('pages.integrations.simplefin.setupTokenLabel')"
            :placeholder="t('pages.integrations.simplefin.setupTokenPlaceholder')"
            @keyup.enter="handleConnectProvider"
          />

          <CredentialsHelpTrigger :label="t('pages.integrations.simplefin.help.trigger')" @click="showHelp = true" />
        </div>

        <Callout v-if="connectError" variant="destructive">
          {{ connectError }}
        </Callout>

        <div class="flex justify-between gap-2">
          <UiButton variant="outline" @click="$emit('cancel')" :disabled="isLoading">
            {{ t('pages.integrations.simplefin.backButton') }}
          </UiButton>

          <DemoRestricted :message="t('demo.featureNotAvailable')" feature="bank_connect_simplefin">
            <UiButton
              @click="handleConnectProvider"
              :disabled="!setupToken || isLoading || isDemo"
              :loading="isLoading"
            >
              {{
                isLoading
                  ? t('pages.integrations.simplefin.connectingButton')
                  : t('pages.integrations.simplefin.connectButton')
              }}
            </UiButton>
          </DemoRestricted>
        </div>
      </div>
    </template>

    <!-- Step 2: Account Preview & Import -->
    <template v-else-if="currentStep === 2">
      <div class="space-y-4">
        <div v-if="isLoading" class="py-8 text-center">{{ t('pages.integrations.simplefin.loadingAccounts') }}</div>

        <template v-else>
          <AccountSelectionList
            v-model="selectedAccountIds"
            v-model:currency-overrides="currencyOverrides"
            :accounts="availableAccounts"
            :provider-type="BANK_PROVIDER_TYPE.SIMPLEFIN"
          />

          <p class="text-muted-foreground flex items-start gap-2 text-xs">
            <InfoIcon class="mt-0.5 size-3.5 shrink-0" />
            {{ t('pages.integrations.simplefin.backfillNote') }}
          </p>

          <div class="flex items-center justify-between gap-2 pt-4">
            <UiButton variant="outline" @click="currentStep = 1" :disabled="isLoading">
              {{ t('pages.integrations.simplefin.backButton') }}
            </UiButton>

            <DemoRestricted :message="t('demo.featureNotAvailable')" feature="bank_connect_simplefin_import_accounts">
              <UiButton
                @click="handleImportAccounts"
                :disabled="selectedAccountIds.length === 0 || isMissingCurrencySelection || isLoading || isDemo"
                :loading="isLoading"
              >
                {{
                  isLoading
                    ? t('pages.integrations.simplefin.importingButton')
                    : t('pages.integrations.simplefin.importButton', selectedAccountIds.length)
                }}
              </UiButton>
            </DemoRestricted>
          </div>
        </template>
      </div>
    </template>

    <InstructionsDialog v-model:open="showHelp" :title="t('pages.integrations.simplefin.help.title')">
      <div class="space-y-2">
        <InstructionStep :step="1">
          <template #title>
            <i18n-t keypath="pages.integrations.simplefin.help.step1" tag="span">
              <template #link>
                <ExternalLink :href="SIMPLEFIN_BRIDGE_URL" />
              </template>
            </i18n-t>
          </template>
        </InstructionStep>
        <InstructionStep :step="2" :title="t('pages.integrations.simplefin.help.step2')" />
        <InstructionStep :step="3" :title="t('pages.integrations.simplefin.help.step3')" />
      </div>

      <template #footer>
        <UiButton as="a" :href="SIMPLEFIN_BRIDGE_URL" target="_blank" rel="noopener">
          <ExternalLinkIcon class="size-4" />
          {{ t('pages.integrations.help.openSite', { site: 'bridge.simplefin.org' }) }}
        </UiButton>
      </template>
    </InstructionsDialog>
  </div>
</template>

<script lang="ts" setup>
import {
  type AvailableAccount,
  connectProvider,
  getAvailableAccounts,
  syncSelectedAccounts,
} from '@/api/bank-data-providers';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import ResponsivePopover from '@/components/common/responsive-popover.vue';
import { DemoRestricted } from '@/components/demo';
import ExternalLink from '@/components/external-link.vue';
import InputField from '@/components/fields/input-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { useNotificationCenter } from '@/components/notification-center';
import { useSyncStatus } from '@/composable/use-sync-status';
import { useAccountsStore, useOnboardingStore, useUserStore } from '@/stores';
import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { ExternalLinkIcon, InfoIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { countMissingCurrencySelections } from '../utils/currency-overrides';
import AccountSelectionList from './account-selection-list.vue';
import CredentialsHelpTrigger from './shared/credentials-help-trigger.vue';
import InstructionStep from './shared/instruction-step.vue';
import InstructionsDialog from './shared/instructions-dialog.vue';

const SIMPLEFIN_BRIDGE_URL = 'https://bridge.simplefin.org';

const { t } = useI18n();

const emit = defineEmits<{
  connected: [];
  cancel: [];
}>();

const { addErrorNotification } = useNotificationCenter();
const accountsStore = useAccountsStore();
const syncStatus = useSyncStatus();
const queryClient = useQueryClient();
const { isDemo } = storeToRefs(useUserStore());

const currentStep = ref(1);
const isLoading = ref(false);
const showHelp = ref(false);

// Step 1 data
const setupToken = ref('');
// The setup token is single-use, so a retry with the same token must re-list the
// accounts of the connection it already claimed instead of claiming again.
const claimed = ref<{ token: string; connectionId: string } | null>(null);
// Inline connect error: kept in the form (not a toast) so it survives long
// enough to read. Cleared as soon as the user edits the token to try again.
const connectError = ref<string | null>(null);
watch(setupToken, () => {
  connectError.value = null;
});

// Step 2 data
const availableAccounts = ref<AvailableAccount[]>([]);
const selectedAccountIds = ref<string[]>([]);
// externalId → user-picked currency for accounts listed without one.
const currencyOverrides = ref<Record<string, string>>({});

// A selected no-currency account without a picked currency blocks the import.
const isMissingCurrencySelection = computed(
  () =>
    countMissingCurrencySelections({
      accounts: availableAccounts.value,
      selectedIds: selectedAccountIds.value,
      overrides: currencyOverrides.value,
    }) > 0,
);

const handleConnectProvider = async () => {
  const token = setupToken.value.trim();
  if (!token || isLoading.value || isDemo.value) return;

  try {
    isLoading.value = true;
    connectError.value = null;

    if (claimed.value?.token !== token) {
      const response = await connectProvider(BANK_PROVIDER_TYPE.SIMPLEFIN, { setupToken: token });
      claimed.value = { token, connectionId: response.connectionId };
    }

    availableAccounts.value = await getAvailableAccounts(claimed.value.connectionId);
    selectedAccountIds.value = [];
    currencyOverrides.value = {};

    currentStep.value = 2;
  } catch (error) {
    connectError.value = getErrorMessage(error) || t('pages.integrations.simplefin.errors.connectFailed');
  } finally {
    isLoading.value = false;
  }
};

const handleImportAccounts = () => {
  if (!claimed.value || selectedAccountIds.value.length === 0 || isDemo.value) {
    return;
  }
  if (isMissingCurrencySelection.value) return;

  const id = claimed.value.connectionId;
  const accountIds = selectedAccountIds.value;

  // Kick off create + initial sync on the server, but don't block the dialog on
  // the (potentially long) backfill — the header spinner shows progress while
  // the accounts sync in the background.
  const importPromise = syncSelectedAccounts(id, accountIds, currencyOverrides.value);

  // Watch the sync in the header (open SSE + load status) without re-triggering.
  void syncStatus.watchSync();

  // Refresh accounts + onboarding once the request resolves; surface failures
  // via a toast (the dialog is already closed). Accounts are persisted even
  // when the initial sync fails — refetch in both branches so the user sees
  // them appear with FAILED sync status instead of nothing.
  //
  // The parent's `integration-added` handler invalidates bank-connection
  // queries as soon as we emit, but the backend hasn't created the accounts
  // yet at that point. Re-invalidate here so the integrations card's
  // accountsCount catches up once the backend finishes, instead of staying
  // pinned at 0 until the page is reloaded.
  const invalidateBankConnectionQueries = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const queryKey = query.queryKey as string[];
        return queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.bankConnectionChange);
      },
    });
  };

  importPromise
    .then(async () => {
      await accountsStore.refetchAccounts();
      invalidateBankConnectionQueries();
      useOnboardingStore().completeTask('connect-bank');
    })
    .catch(async (error) => {
      await accountsStore.refetchAccounts();
      invalidateBankConnectionQueries();
      addErrorNotification(getErrorMessage(error) || t('pages.integrations.simplefin.errors.importFailed'));
    });

  emit('connected');
};

const getErrorMessage = (error: unknown): string | undefined => {
  const apiMessage = (error as { data?: { message?: string } })?.data?.message;
  if (apiMessage) return apiMessage;
  if (error instanceof Error && error.message) return error.message;
  return undefined;
};
</script>

<template>
  <div class="space-y-4">
    <!-- Step 1: Enter API Key -->
    <template v-if="currentStep === 1">
      <div class="space-y-4">
        <div>
          <InputField
            v-model="apiKey"
            type="password"
            :label="t('pages.integrations.lunchflow.apiKeyLabel')"
            :placeholder="t('pages.integrations.lunchflow.apiKeyPlaceholder')"
            @keyup.enter="handleConnectProvider"
          />

          <CredentialsHelpTrigger :label="t('pages.integrations.lunchflow.help.trigger')" @click="showHelp = true" />
        </div>
        <div class="flex justify-between gap-2">
          <UiButton variant="outline" @click="$emit('cancel')" :disabled="isLoading">
            {{ t('pages.integrations.lunchflow.backButton') }}
          </UiButton>

          <DemoRestricted :message="t('demo.featureNotAvailable')" feature="bank_connect_lunchflow">
            <UiButton @click="handleConnectProvider" :disabled="!apiKey || isLoading || isDemo">
              {{
                isLoading
                  ? t('pages.integrations.lunchflow.connectingButton')
                  : t('pages.integrations.lunchflow.connectButton')
              }}
            </UiButton>
          </DemoRestricted>
        </div>
      </div>
    </template>

    <!-- Step 2: Account Preview & Import -->
    <template v-else-if="currentStep === 2">
      <div class="space-y-4">
        <div v-if="isLoading" class="py-8 text-center">{{ t('pages.integrations.lunchflow.loadingAccounts') }}</div>

        <template v-else>
          <div class="text-muted-foreground mb-4 text-sm">
            {{ t('pages.integrations.lunchflow.accountsPreviewHint', { count: availableAccounts.length }) }}
          </div>

          <div class="space-y-2">
            <div
              v-for="account in availableAccounts"
              :key="account.externalId"
              class="flex items-center gap-3 rounded-md border p-3"
            >
              <img
                v-if="account.metadata?.institutionLogo"
                :src="account.metadata.institutionLogo as string"
                :alt="account.metadata?.institutionName as string"
                class="size-8 rounded-full object-contain"
              />
              <div v-else class="bg-muted flex size-8 items-center justify-center rounded-full">
                <BuildingIcon class="text-muted-foreground size-4" />
              </div>
              <div class="flex-1">
                <div class="font-medium">{{ account.name }}</div>
                <div class="text-muted-foreground text-xs">
                  {{ account.metadata?.institutionName || '' }}
                </div>
              </div>
              <div class="text-right">
                <div class="text-sm font-medium">
                  {{ formatBalance(account.balance, account.currency) }}
                </div>
                <div class="text-muted-foreground text-xs">{{ account.currency }}</div>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2 pt-4">
            <UiButton variant="outline" @click="currentStep = 1" :disabled="isLoading">
              {{ t('pages.integrations.lunchflow.backButton') }}
            </UiButton>

            <div class="flex items-center gap-2">
              <Tooltip.TooltipProvider>
                <Tooltip.Tooltip :delay-duration="0">
                  <Tooltip.TooltipTrigger as-child>
                    <UiButton variant="ghost" size="sm" :disabled="isLoading" @click="handleSkipImport">
                      {{ t('pages.integrations.lunchflow.skipButton') }}
                      <InfoIcon class="text-muted-foreground ml-1 size-3.5" />
                    </UiButton>
                  </Tooltip.TooltipTrigger>
                  <Tooltip.TooltipContent class="max-w-60 p-3">
                    <p class="text-sm leading-5">
                      {{ t('pages.integrations.lunchflow.skipTooltip') }}
                    </p>
                  </Tooltip.TooltipContent>
                </Tooltip.Tooltip>
              </Tooltip.TooltipProvider>

              <DemoRestricted :message="t('demo.featureNotAvailable')" feature="bank_connect_lunchflow_import_accounts">
                <UiButton
                  @click="handleImportAccounts"
                  :disabled="availableAccounts.length === 0 || isLoading || isDemo"
                >
                  {{
                    isLoading
                      ? t('pages.integrations.lunchflow.importingButton')
                      : t('pages.integrations.lunchflow.importButton', { count: availableAccounts.length })
                  }}
                </UiButton>
              </DemoRestricted>
            </div>
          </div>
        </template>
      </div>
    </template>

    <InstructionsDialog v-model:open="showHelp" :title="t('pages.integrations.lunchflow.help.title')">
      <div class="space-y-2">
        <InstructionStep :step="1">
          <template #title>
            <i18n-t keypath="pages.integrations.lunchflow.help.step1" tag="span">
              <template #link>
                <ExternalLink :href="LUNCHFLOW_DASHBOARD_URL" />
              </template>
            </i18n-t>
          </template>
        </InstructionStep>
        <InstructionStep :step="2" :title="t('pages.integrations.lunchflow.help.step2')" />
        <InstructionStep :step="3" :title="t('pages.integrations.lunchflow.help.step3')" />
      </div>

      <template #footer>
        <UiButton as="a" :href="LUNCHFLOW_DASHBOARD_URL" target="_blank" rel="noopener">
          <ExternalLinkIcon class="size-4" />
          {{ t('pages.integrations.help.openSite', { site: 'lunchflow.app' }) }}
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
import { DemoRestricted } from '@/components/demo';
import ExternalLink from '@/components/external-link.vue';
import InputField from '@/components/fields/input-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import * as Tooltip from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useSyncStatus } from '@/composable/use-sync-status';
import { formatUIAmount } from '@/js/helpers';
import { useAccountsStore, useOnboardingStore, useUserStore } from '@/stores';
import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { BuildingIcon, ExternalLinkIcon, InfoIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import CredentialsHelpTrigger from './shared/credentials-help-trigger.vue';
import InstructionStep from './shared/instruction-step.vue';
import InstructionsDialog from './shared/instructions-dialog.vue';

const LUNCHFLOW_DASHBOARD_URL = 'https://lunchflow.app/dashboard';

const { t } = useI18n();

const emit = defineEmits<{
  connected: [];
  cancel: [];
}>();

const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const accountsStore = useAccountsStore();
const { watchSync } = useSyncStatus();
const { isDemo } = storeToRefs(useUserStore());

const currentStep = ref(1);
const isLoading = ref(false);
const showHelp = ref(false);

// Step 1 data
const apiKey = ref('');
// The key is reusable, so a retry with the same key must re-list the accounts of
// the connection it already created instead of creating a duplicate one.
const claimed = ref<{ token: string; connectionId: string } | null>(null);

// Step 2 data
const availableAccounts = ref<AvailableAccount[]>([]);

const handleConnectProvider = async () => {
  const token = apiKey.value.trim();
  if (!token || isLoading.value || isDemo.value) return;

  try {
    isLoading.value = true;

    if (claimed.value?.token !== token) {
      const response = await connectProvider(BANK_PROVIDER_TYPE.LUNCHFLOW, { apiKey: token });
      claimed.value = { token, connectionId: response.connectionId };
    }

    availableAccounts.value = await getAvailableAccounts(claimed.value.connectionId);

    currentStep.value = 2;
  } catch (error) {
    const message = getErrorMessage(error) || t('pages.integrations.lunchflow.errors.connectFailed');
    addErrorNotification(message);
  } finally {
    isLoading.value = false;
  }
};

const handleSkipImport = () => {
  emit('connected');
};

const handleImportAccounts = async () => {
  if (!claimed.value || availableAccounts.value.length === 0 || isLoading.value || isDemo.value) {
    return;
  }

  try {
    isLoading.value = true;

    const allAccountIds = availableAccounts.value.map((a) => a.externalId);
    await syncSelectedAccounts(claimed.value.connectionId, allAccountIds);
    // Follow the server-side initial sync in the header without re-triggering it.
    void watchSync();

    await accountsStore.refetchAccounts();

    const onboardingStore = useOnboardingStore();
    onboardingStore.completeTask('connect-bank');

    addSuccessNotification(t('pages.integrations.lunchflow.importSuccess', { count: allAccountIds.length }));

    emit('connected');
  } catch (error) {
    const message = getErrorMessage(error) || t('pages.integrations.lunchflow.errors.importFailed');
    addErrorNotification(message);
  } finally {
    isLoading.value = false;
  }
};

const getErrorMessage = (error: unknown): string | undefined => {
  const apiMessage = (error as { data?: { message?: string } })?.data?.message;
  if (apiMessage) return apiMessage;
  if (error instanceof Error && error.message) return error.message;
  return undefined;
};

const formatBalance = (balance: number, currency: string) => formatUIAmount(balance, { currency });
</script>

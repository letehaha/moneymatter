<template>
  <div class="space-y-4">
    <!-- Step 1: Enter Akahu tokens -->
    <template v-if="currentStep === 1">
      <div class="space-y-4">
        <div class="space-y-4">
          <div>
            <InputField
              v-model="userToken"
              type="password"
              :label="t('pages.integrations.akahu.userTokenLabel')"
              :placeholder="t('pages.integrations.akahu.userTokenPlaceholder')"
            />
            <div class="text-muted-foreground mt-1 text-xs">{{ t('pages.integrations.akahu.userTokenHint') }}</div>
          </div>
          <div>
            <InputField
              v-model="appToken"
              type="password"
              :label="t('pages.integrations.akahu.appTokenLabel')"
              :placeholder="t('pages.integrations.akahu.appTokenPlaceholder')"
              @keyup.enter="handleConnectProvider"
            />
            <div class="text-muted-foreground mt-1 text-xs">{{ t('pages.integrations.akahu.appTokenHint') }}</div>
          </div>

          <CredentialsHelpTrigger :label="t('pages.integrations.akahu.help.trigger')" @click="showHelp = true" />
        </div>
        <div class="flex justify-between gap-2">
          <UiButton variant="outline" @click="$emit('cancel')" :disabled="isLoading">
            {{ t('pages.integrations.akahu.backButton') }}
          </UiButton>

          <DemoRestricted :message="t('demo.featureNotAvailable')" feature="bank_connect_akahu">
            <UiButton @click="handleConnectProvider" :disabled="!canConnect || isLoading || isDemo">
              {{
                isLoading ? t('pages.integrations.akahu.connectingButton') : t('pages.integrations.akahu.connectButton')
              }}
            </UiButton>
          </DemoRestricted>
        </div>
      </div>
    </template>

    <!-- Step 2: Account Preview & Import -->
    <template v-else-if="currentStep === 2">
      <div class="space-y-4">
        <div v-if="isLoading" class="py-8 text-center">{{ t('pages.integrations.akahu.loadingAccounts') }}</div>

        <template v-else>
          <div class="text-muted-foreground mb-4 text-sm">
            {{ t('pages.integrations.akahu.accountsPreviewHint', { count: availableAccounts.length }) }}
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
                  {{ formatUIAmount(account.balance, { currency: account.currency }) }}
                </div>
                <div class="text-muted-foreground text-xs">{{ account.currency }}</div>
              </div>
            </div>
          </div>

          <div class="flex items-center justify-between gap-2 pt-4">
            <UiButton variant="outline" @click="currentStep = 1" :disabled="isLoading">
              {{ t('pages.integrations.akahu.backButton') }}
            </UiButton>

            <div class="flex items-center gap-2">
              <Tooltip.TooltipProvider>
                <Tooltip.Tooltip :delay-duration="0">
                  <Tooltip.TooltipTrigger as-child>
                    <UiButton variant="ghost" size="sm" :disabled="isLoading" @click="handleSkipImport">
                      {{ t('pages.integrations.akahu.skipButton') }}
                      <InfoIcon class="text-muted-foreground size-3.5" />
                    </UiButton>
                  </Tooltip.TooltipTrigger>
                  <Tooltip.TooltipContent class="max-w-60 p-3">
                    <p class="text-sm leading-5">
                      {{ t('pages.integrations.akahu.skipTooltip') }}
                    </p>
                  </Tooltip.TooltipContent>
                </Tooltip.Tooltip>
              </Tooltip.TooltipProvider>

              <DemoRestricted :message="t('demo.featureNotAvailable')" feature="bank_connect_akahu_import_accounts">
                <UiButton
                  @click="handleImportAccounts"
                  :disabled="availableAccounts.length === 0 || isLoading || isDemo"
                >
                  {{
                    isLoading
                      ? t('pages.integrations.akahu.importingButton')
                      : t('pages.integrations.akahu.importButton', { count: availableAccounts.length })
                  }}
                </UiButton>
              </DemoRestricted>
            </div>
          </div>
        </template>
      </div>
    </template>

    <InstructionsDialog v-model:open="showHelp" :title="t('pages.integrations.akahu.help.title')">
      <div class="space-y-2">
        <InstructionStep :step="1">
          <template #title>
            <i18n-t keypath="pages.integrations.akahu.help.step1" tag="span">
              <template #link>
                <ExternalLink :href="AKAHU_APPS_URL" />
              </template>
            </i18n-t>
          </template>
        </InstructionStep>
        <InstructionStep :step="2" :title="t('pages.integrations.akahu.help.step2')" />
        <InstructionStep :step="3" :title="t('pages.integrations.akahu.help.step3')" />
      </div>

      <template #footer>
        <UiButton as="a" :href="AKAHU_APPS_URL" target="_blank" rel="noopener">
          <ExternalLinkIcon class="size-4" />
          {{ t('pages.integrations.help.openSite', { site: 'my.akahu.nz' }) }}
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
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import CredentialsHelpTrigger from './shared/credentials-help-trigger.vue';
import InstructionStep from './shared/instruction-step.vue';
import InstructionsDialog from './shared/instructions-dialog.vue';

const AKAHU_APPS_URL = 'https://my.akahu.nz/apps';

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

// Step 1 data — a personal app hands out both tokens on the same page.
const userToken = ref('');
const appToken = ref('');
// The token pair is reusable, so a retry with the same pair must re-list the
// accounts of the connection it already created instead of creating a duplicate one.
const claimed = ref<{ userToken: string; appToken: string; connectionId: string } | null>(null);

const canConnect = computed(() => userToken.value.trim().length > 0 && appToken.value.trim().length > 0);

// Step 2 data
const availableAccounts = ref<AvailableAccount[]>([]);

const handleConnectProvider = async () => {
  const userTokenValue = userToken.value.trim();
  const appTokenValue = appToken.value.trim();
  if (!userTokenValue || !appTokenValue || isLoading.value || isDemo.value) return;

  try {
    isLoading.value = true;

    if (!claimed.value || claimed.value.userToken !== userTokenValue || claimed.value.appToken !== appTokenValue) {
      const response = await connectProvider(BANK_PROVIDER_TYPE.AKAHU, {
        userToken: userTokenValue,
        appToken: appTokenValue,
      });
      claimed.value = { userToken: userTokenValue, appToken: appTokenValue, connectionId: response.connectionId };
    }

    availableAccounts.value = await getAvailableAccounts(claimed.value.connectionId);

    currentStep.value = 2;
  } catch (error) {
    const message = getErrorMessage(error) || t('pages.integrations.akahu.errors.connectFailed');
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

    addSuccessNotification(t('pages.integrations.akahu.importSuccess', { count: allAccountIds.length }));

    emit('connected');
  } catch (error) {
    const message = getErrorMessage(error) || t('pages.integrations.akahu.errors.importFailed');
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
</script>

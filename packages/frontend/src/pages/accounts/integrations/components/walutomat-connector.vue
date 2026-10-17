<template>
  <div class="space-y-4">
    <!-- Step 1: Enter Credentials -->
    <template v-if="currentStep === 1">
      <div class="space-y-4">
        <div>
          <InputField
            v-model="apiKey"
            type="password"
            :label="t('pages.integrations.walutomat.apiKeyLabel')"
            :placeholder="t('pages.integrations.walutomat.apiKeyPlaceholder')"
          />
          <p class="text-muted-foreground mt-1 text-xs">{{ t('pages.integrations.walutomat.apiKeyHint') }}</p>
        </div>

        <div>
          <TextareaField
            v-model="privateKey"
            class="font-mono text-xs"
            rows="6"
            :label="t('pages.integrations.walutomat.privateKeyLabel')"
            :placeholder="t('pages.integrations.walutomat.privateKeyPlaceholder')"
          />
          <p class="text-muted-foreground mt-1 text-xs">
            {{ t('pages.integrations.walutomat.privateKeyHint') }}
          </p>
          <CredentialsHelpTrigger
            :label="t('pages.integrations.walutomat.help.trigger')"
            @click="showInstructions = true"
          />
        </div>

        <div class="flex justify-between gap-2">
          <UiButton variant="outline" :disabled="isLoading" @click="$emit('cancel')">
            {{ t('pages.integrations.walutomat.backButton') }}
          </UiButton>

          <DemoRestricted :message="t('demo.featureNotAvailable')" feature="bank_connect_walutomat">
            <UiButton :disabled="!canConnect || isLoading || isDemo" @click="handleConnect">
              {{
                isLoading
                  ? t('pages.integrations.walutomat.connectingButton')
                  : t('pages.integrations.walutomat.connectButton')
              }}
            </UiButton>
          </DemoRestricted>
        </div>
      </div>
    </template>

    <!-- Step 2: Select Wallets -->
    <template v-else-if="currentStep === 2">
      <div class="space-y-4">
        <div v-if="isLoading" class="py-8 text-center">{{ t('pages.integrations.walutomat.loadingWallets') }}</div>

        <template v-else>
          <div class="text-muted-foreground mb-4 text-sm">
            {{ t('pages.integrations.walutomat.selectWalletsHint', { count: availableAccounts.length }) }}
          </div>

          <!-- Select All -->
          <label class="mb-2 flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Checkbox :model-value="selectAllState" @update:model-value="toggleAll" />
            {{ t('pages.integrations.walutomat.selectAll') }}
          </label>

          <div class="space-y-2">
            <label
              v-for="account in availableAccounts"
              :key="account.externalId"
              class="flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors"
              :class="{ 'border-primary bg-primary/5': selectedIds.has(account.externalId) }"
            >
              <Checkbox
                :model-value="selectedIds.has(account.externalId)"
                @update:model-value="toggleAccount(account.externalId)"
              />
              <div class="bg-muted flex size-8 items-center justify-center rounded-full text-xs font-bold">
                {{ account.currency }}
              </div>
              <div class="flex-1">
                <div class="font-medium">{{ account.name }}</div>
              </div>
              <div class="text-right">
                <div class="text-sm font-medium">
                  {{ formatBalance(account.balance, account.currency) }}
                </div>
                <div class="text-muted-foreground text-xs">{{ account.currency }}</div>
              </div>
            </label>
          </div>

          <div class="flex items-center justify-between gap-2 pt-4">
            <UiButton variant="outline" :disabled="isLoading" @click="currentStep = 1">
              {{ t('pages.integrations.walutomat.backButton') }}
            </UiButton>

            <DemoRestricted :message="t('demo.featureNotAvailable')" feature="bank_connect_walutomat_import_accounts">
              <UiButton :disabled="selectedIds.size === 0 || isLoading || isDemo" @click="handleImport">
                {{
                  isLoading
                    ? t('pages.integrations.walutomat.importingButton')
                    : t('pages.integrations.walutomat.importButton', { count: selectedIds.size })
                }}
              </UiButton>
            </DemoRestricted>
          </div>
        </template>
      </div>
    </template>

    <!-- Instructions Dialog -->
    <WalutomatInstructionsDialog v-model:open="showInstructions" />
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
import InputField from '@/components/fields/input-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Checkbox, type CheckedState } from '@/components/lib/ui/checkbox';
import { useNotificationCenter } from '@/components/notification-center';
import { useSyncStatus } from '@/composable/use-sync-status';
import { formatUIAmount } from '@/js/helpers';
import { useAccountsStore, useOnboardingStore, useUserStore } from '@/stores';
import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import CredentialsHelpTrigger from './shared/credentials-help-trigger.vue';
import WalutomatInstructionsDialog from './walutomat/instructions-dialog.vue';

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
const showInstructions = ref(false);

// Step 1 data
const apiKey = ref('');
const privateKey = ref('');
const connectionId = ref<string | null>(null);

// Step 2 data
const availableAccounts = ref<AvailableAccount[]>([]);
const selectedIds = ref<Set<string>>(new Set());

const canConnect = computed(() => apiKey.value.length > 0 && privateKey.value.length > 0);

const selectAllState = computed<CheckedState>(() => {
  if (selectedIds.value.size === 0) return false;
  if (selectedIds.value.size === availableAccounts.value.length) return true;
  return 'indeterminate';
});

const handleConnect = async () => {
  if (!canConnect.value || isLoading.value || isDemo.value) return;

  try {
    isLoading.value = true;

    const response = await connectProvider(BANK_PROVIDER_TYPE.WALUTOMAT, {
      apiKey: apiKey.value,
      privateKey: privateKey.value,
    });

    connectionId.value = response.connectionId;

    const accounts = await getAvailableAccounts(response.connectionId);
    availableAccounts.value = accounts;

    // Pre-select all wallets
    selectedIds.value = new Set(accounts.map((a) => a.externalId));

    currentStep.value = 2;
  } catch (error) {
    const message = getErrorMessage(error) || t('pages.integrations.walutomat.errors.connectFailed');
    addErrorNotification(message);
  } finally {
    isLoading.value = false;
  }
};

const toggleAll = () => {
  if (selectedIds.value.size === availableAccounts.value.length) {
    selectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(availableAccounts.value.map((a) => a.externalId));
  }
};

const toggleAccount = (externalId: string) => {
  const newSet = new Set(selectedIds.value);
  if (newSet.has(externalId)) {
    newSet.delete(externalId);
  } else {
    newSet.add(externalId);
  }
  selectedIds.value = newSet;
};

const handleImport = async () => {
  if (!connectionId.value || selectedIds.value.size === 0 || isLoading.value || isDemo.value) {
    return;
  }

  try {
    isLoading.value = true;

    await syncSelectedAccounts(connectionId.value, [...selectedIds.value]);
    // Follow the server-side initial sync in the header without re-triggering it.
    void watchSync();

    await accountsStore.refetchAccounts();

    const onboardingStore = useOnboardingStore();
    onboardingStore.completeTask('connect-bank');

    addSuccessNotification(t('pages.integrations.walutomat.importSuccess', { count: selectedIds.value.size }));

    emit('connected');
  } catch (error) {
    const message = getErrorMessage(error) || t('pages.integrations.walutomat.errors.importFailed');
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

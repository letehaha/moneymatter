<template>
  <div class="space-y-4">
    <!-- Beta disclaimer -->
    <div
      class="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400"
    >
      <TriangleAlertIcon class="mt-0.5 size-5 shrink-0" />
      <div class="space-y-2">
        <p class="font-semibold">{{ t('pages.integrations.enableBankingConnector.beta.title') }}</p>
        <p class="opacity-90">
          {{ t('pages.integrations.enableBankingConnector.beta.description') }}
        </p>
      </div>
    </div>

    <!-- Step 1: Enter Enable Banking Credentials -->
    <template v-if="currentStep === 1">
      <div class="space-y-4">
        <div>
          <InputField
            v-model="appId"
            type="text"
            :label="t('pages.integrations.enableBankingConnector.credentials.appIdLabel')"
            :placeholder="$t('pages.integrations.enableBanking.placeholders.appId')"
          />
          <p class="text-muted-foreground mt-1 text-xs">
            {{ t('pages.integrations.enableBankingConnector.credentials.appIdHint') }}
          </p>
        </div>
        <div>
          <TextareaField
            v-model="privateKey"
            class="font-mono text-xs"
            rows="6"
            :label="t('pages.integrations.enableBankingConnector.credentials.privateKeyLabel')"
            :placeholder="$t('pages.integrations.enableBanking.placeholders.privateKey')"
          />
          <p class="text-muted-foreground mt-1 text-xs">
            {{ t('pages.integrations.enableBankingConnector.credentials.privateKeyHint') }}
          </p>
          <CredentialsHelpTrigger
            :label="t('pages.integrations.enableBanking.help.trigger')"
            @click="showHelpDialog = true"
          />
        </div>
        <div class="flex justify-between gap-2">
          <UiButton variant="outline" @click="$emit('cancel')" :disabled="isLoading">
            {{ t('pages.integrations.enableBankingConnector.buttons.back') }}
          </UiButton>

          <DemoRestricted :message="t('demo.featureNotAvailable')" feature="bank_connect_enablebanking">
            <UiButton @click="handleLoadBanks" :disabled="!appId || !privateKey || isLoading || isDemo">
              {{
                isLoading
                  ? t('pages.integrations.enableBankingConnector.buttons.loading')
                  : t('pages.integrations.enableBankingConnector.buttons.next')
              }}
            </UiButton>
          </DemoRestricted>
        </div>
      </div>
    </template>

    <!-- Step 2: Select Country -->
    <template v-else-if="currentStep === 2">
      <div class="space-y-4">
        <div v-if="isLoading" class="py-8 text-center">
          {{ t('pages.integrations.enableBankingConnector.steps.loadingCountries') }}
        </div>

        <template v-else>
          <div class="text-muted-foreground mb-4 text-sm">
            {{ t('pages.integrations.enableBankingConnector.steps.selectCountryHint') }}
          </div>

          <div>
            <InputField
              v-model="countryFilter"
              type="text"
              :label="t('pages.integrations.enableBankingConnector.steps.countryLabel')"
              :placeholder="$t('pages.integrations.enableBanking.placeholders.searchCountries')"
            />
          </div>

          <div class="max-h-64 space-y-2 overflow-y-auto">
            <button
              v-for="country in filteredCountries"
              :key="country"
              @click="selectCountry(country)"
              class="hover:bg-hover w-full rounded-md border p-3 text-left transition-colors"
            >
              {{ getCountryName(country) }} ({{ country }})
            </button>
          </div>

          <div class="flex gap-2 pt-4">
            <UiButton variant="outline" @click="currentStep = 1" :disabled="isLoading">
              {{ t('pages.integrations.enableBankingConnector.buttons.back') }}
            </UiButton>
          </div>
        </template>
      </div>
    </template>

    <!-- Step 3: Select Bank -->
    <template v-else-if="currentStep === 3">
      <div class="space-y-4">
        <div v-if="isLoading" class="py-8 text-center">
          {{ t('pages.integrations.enableBankingConnector.steps.loadingBanks') }}
        </div>

        <template v-else>
          <div class="text-muted-foreground mb-4 text-sm">
            {{ t('pages.integrations.enableBankingConnector.steps.selectBankHint', { country: selectedCountry }) }}
          </div>

          <div>
            <InputField
              v-model="bankFilter"
              type="text"
              :label="t('pages.integrations.enableBankingConnector.steps.bankLabel')"
              :placeholder="$t('pages.integrations.enableBanking.placeholders.searchBanks')"
            />
          </div>

          <div class="max-h-64 space-y-2 overflow-y-auto">
            <button
              v-for="bank in filteredBanks"
              :key="bank.name"
              @click="selectBank(bank)"
              class="hover:bg-hover w-full rounded-md border p-3 text-left transition-colors"
            >
              <div class="font-medium">{{ bank.name }}</div>
              <div v-if="bank.bic" class="text-muted-foreground text-xs">
                {{ t('pages.integrations.enableBankingConnector.credentials.bicLabel') }} {{ bank.bic }}
              </div>
            </button>
          </div>

          <div class="flex gap-2 pt-4">
            <UiButton variant="outline" @click="currentStep = 2" :disabled="isLoading">
              {{ t('pages.integrations.enableBankingConnector.buttons.back') }}
            </UiButton>
          </div>
        </template>
      </div>
    </template>

    <!-- Step 4: Redirect to Bank Authorization -->
    <template v-else-if="currentStep === 4">
      <div class="space-y-4">
        <div v-if="isLoading" class="py-8 text-center">
          {{ t('pages.integrations.enableBankingConnector.steps.connectingToBank', { bank: selectedBankName }) }}
        </div>

        <template v-else-if="authUrl">
          <div class="text-muted-foreground space-y-4 text-sm">
            <p>
              {{ t('pages.integrations.enableBankingConnector.steps.authDescription', { bank: selectedBankName }) }}
            </p>
            <p class="text-warning-text font-medium">
              {{ t('pages.integrations.enableBankingConnector.steps.authWarning', { bank: selectedBankName }) }}
            </p>
          </div>

          <div class="flex gap-2 pt-4">
            <UiButton @click="openAuthUrl">{{
              t('pages.integrations.enableBankingConnector.steps.authorizeButton', { bank: selectedBankName })
            }}</UiButton>
            <UiButton variant="outline" @click="currentStep = 3" :disabled="isLoading">
              {{ t('pages.integrations.enableBankingConnector.buttons.back') }}
            </UiButton>
          </div>
        </template>
      </div>
    </template>

    <!-- Step 5: Select Accounts (shown after OAuth callback) -->
    <template v-else-if="currentStep === 5">
      <div class="space-y-4">
        <div v-if="isLoading" class="py-8 text-center">
          {{ t('pages.integrations.enableBankingConnector.steps.loadingAccounts') }}
        </div>

        <template v-else>
          <div class="text-muted-foreground mb-4 text-sm">
            {{ t('pages.integrations.enableBankingConnector.steps.selectAccountsHint') }}
          </div>

          <AccountSelectionList
            v-model="selectedAccountIds"
            v-model:currency-overrides="currencyOverrides"
            :accounts="availableAccounts"
            :provider-type="BANK_PROVIDER_TYPE.ENABLE_BANKING"
          />

          <div class="flex gap-2 pt-4">
            <DemoRestricted
              :message="t('demo.featureNotAvailable')"
              feature="bank_connect_enablebanking_import_accounts"
            >
              <UiButton
                @click="handleSyncAccounts"
                :disabled="selectedAccountIds.length === 0 || isMissingCurrencySelection || isLoading || isDemo"
              >
                {{
                  isLoading
                    ? t('pages.integrations.enableBankingConnector.buttons.syncing')
                    : t('pages.integrations.enableBankingConnector.buttons.sync', selectedAccountIds.length)
                }}
              </UiButton>
            </DemoRestricted>
          </div>
        </template>
      </div>
    </template>

    <!-- Help Dialog -->
    <InstructionsDialog v-model:open="showHelpDialog" />
  </div>
</template>

<script lang="ts" setup>
import {
  type ASPSP,
  type AvailableAccount,
  connectProvider,
  getAvailableAccounts,
  getEnableBankingBanks,
  getEnableBankingCountries,
  syncSelectedAccounts,
} from '@/api/bank-data-providers';
import { DemoRestricted } from '@/components/demo';
import InputField from '@/components/fields/input-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { useSyncStatus } from '@/composable/use-sync-status';
import { useAccountsStore, useOnboardingStore, useUserStore } from '@/stores';
import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { TriangleAlertIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { countMissingCurrencySelections } from '../utils/currency-overrides';
import AccountSelectionList from './account-selection-list.vue';
import InstructionsDialog from './enable-banking/instructions-dialog.vue';
import CredentialsHelpTrigger from './shared/credentials-help-trigger.vue';

const emit = defineEmits<{
  connected: [];
  cancel: [];
  authStarted: [connectionId: string];
}>();

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const accountsStore = useAccountsStore();
const { watchSync } = useSyncStatus();
const { isDemo } = storeToRefs(useUserStore());

const currentStep = ref(1);
const isLoading = ref(false);
const showHelpDialog = ref(false);

// Step 1 data
const appId = ref('');
const privateKey = ref('');

// Step 2 data
const countries = ref<string[]>([]);
const countryFilter = ref('');
const selectedCountry = ref('');

// Step 3 data
const banks = ref<ASPSP[]>([]);
const bankFilter = ref('');
const selectedBank = ref<ASPSP | null>(null);
const selectedBankName = computed(() => selectedBank.value?.name || '');

// Step 4 data
const authUrl = ref('');
const connectionId = ref<string | null>(null);

// Step 5 data
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

const filteredCountries = computed(() => {
  if (!countryFilter.value) return countries.value;
  const filter = countryFilter.value.toLowerCase();
  return countries.value.filter(
    (c) => c.toLowerCase().includes(filter) || getCountryName(c).toLowerCase().includes(filter),
  );
});

const filteredBanks = computed(() => {
  if (!bankFilter.value) return banks.value;
  const filter = bankFilter.value.toLowerCase();
  return banks.value.filter((b) => b.name.toLowerCase().includes(filter) || b.bic?.toLowerCase().includes(filter));
});

const handleLoadBanks = async () => {
  if (!appId.value || !privateKey.value || isLoading.value || isDemo.value) return;

  try {
    isLoading.value = true;
    currentStep.value = 2;
    countries.value = await getEnableBankingCountries(appId.value, privateKey.value);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : t('pages.integrations.enableBankingConnector.errors.loadCountriesFailed');
    currentStep.value = 1;
    addErrorNotification(message);
  } finally {
    isLoading.value = false;
  }
};

const selectCountry = async (country: string) => {
  selectedCountry.value = country;

  try {
    isLoading.value = true;
    currentStep.value = 3;
    banks.value = await getEnableBankingBanks(appId.value, privateKey.value, country);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : t('pages.integrations.enableBanking.errors.failedToLoadBanks');
    currentStep.value = 2;
    addErrorNotification(message);
  } finally {
    isLoading.value = false;
  }
};

const selectBank = async (bank: ASPSP) => {
  selectedBank.value = bank;

  try {
    isLoading.value = true;

    currentStep.value = 4;
    // Connect provider - this will return the auth URL
    const response = await connectProvider(BANK_PROVIDER_TYPE.ENABLE_BANKING, {
      appId: appId.value,
      privateKey: privateKey.value,
      bankName: bank.name,
      bankCountry: bank.country,
      maxConsentValidity: bank.maximum_consent_validity, // Pass bank's max consent validity
    });

    connectionId.value = response.connectionId;

    // Extract auth URL from response
    if (response.authUrl) {
      authUrl.value = response.authUrl;

      // Store connection ID for OAuth callback
      localStorage.setItem('pendingEnableBankingConnectionId', String(response.connectionId));

      // Notify parent that auth has started
      emit('authStarted', response.connectionId);
    } else {
      addErrorNotification(t('pages.integrations.enableBanking.errors.noAuthUrl'));
      currentStep.value = 3;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : t('pages.integrations.enableBanking.errors.failedToConnectProvider');
    currentStep.value = 3;
    addErrorNotification(message);
  } finally {
    isLoading.value = false;
  }
};

const openAuthUrl = () => {
  if (authUrl.value) {
    window.location.href = authUrl.value;
  }
};

// This method should be called from the parent after OAuth callback
const loadAccounts = async (connId: string) => {
  try {
    isLoading.value = true;
    connectionId.value = connId;
    availableAccounts.value = await getAvailableAccounts(connId);
    currentStep.value = 5;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : t('pages.integrations.enableBankingConnector.errors.loadAccountsFailed');
    addErrorNotification(message);
  } finally {
    isLoading.value = false;
  }
};

const handleSyncAccounts = async () => {
  if (!connectionId.value || selectedAccountIds.value.length === 0 || isLoading.value || isDemo.value) {
    return;
  }
  if (isMissingCurrencySelection.value) return;

  try {
    isLoading.value = true;

    await syncSelectedAccounts(connectionId.value, selectedAccountIds.value, currencyOverrides.value);
    // Follow the server-side initial sync in the header without re-triggering it.
    void watchSync();

    // Refresh accounts store
    await accountsStore.refetchAccounts();

    // Mark onboarding task as complete
    const onboardingStore = useOnboardingStore();
    onboardingStore.completeTask('connect-bank');

    addSuccessNotification(
      t('pages.integrations.enableBankingConnector.syncSuccess', { count: selectedAccountIds.value.length }),
    );

    // Emit connected event to close dialog
    emit('connected');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : t('pages.integrations.enableBankingConnector.errors.syncFailed');
    addErrorNotification(message);
  } finally {
    isLoading.value = false;
  }
};

// Simple country name mapping (can be expanded)
const getCountryName = (code: string): string => {
  const names: Record<string, string> = {
    FI: 'Finland',
    SE: 'Sweden',
    NO: 'Norway',
    DK: 'Denmark',
    DE: 'Germany',
    FR: 'France',
    ES: 'Spain',
    IT: 'Italy',
    NL: 'Netherlands',
    BE: 'Belgium',
    PL: 'Poland',
    GB: 'United Kingdom',
    IE: 'Ireland',
    AT: 'Austria',
    CH: 'Switzerland',
  };
  return names[code] || code;
};

// Expose method for parent to trigger account loading after OAuth
defineExpose({
  loadAccounts,
});
</script>

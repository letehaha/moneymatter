<template>
  <div class="flex max-w-4xl flex-col gap-6">
    <Card>
      <CardHeader class="border-b">
        <h2 class="mb-2 text-2xl font-semibold">{{ $t('settings.general.title') }}</h2>
        <p class="text-sm opacity-80">{{ $t('settings.general.description') }}</p>
      </CardHeader>

      <CardContent class="mt-6 flex flex-col gap-6">
        <div class="flex items-center justify-between gap-4">
          <div class="flex-1">
            <div class="text-sm font-medium">
              {{ $t('settings.general.creditLimit.label') }}
            </div>
            <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
              {{ $t('settings.general.creditLimit.description') }}
              <DocsLink path="/settings/general-settings/#include-credit-limits-in-balance" />
            </p>
          </div>
          <Switch
            :model-value="includeCreditLimitInStats"
            :disabled="isUpdating"
            @update:model-value="handleCreditLimitToggle"
          />
        </div>

        <Separator />

        <div class="flex items-center justify-between gap-4">
          <div class="flex-1">
            <div class="text-sm font-medium">
              {{ $t('settings.general.manualTransferMatching.label') }}
            </div>
            <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
              {{ $t('settings.general.manualTransferMatching.description') }}
              <DocsLink path="/settings/general-settings/#match-transfers-with-manual-accounts" />
            </p>
          </div>
          <Switch
            :model-value="matchTransfersWithManualAccounts"
            :disabled="isUpdating"
            @update:model-value="handleManualTransferMatchingToggle"
          />
        </div>

        <Separator />

        <div class="flex items-center justify-between gap-4">
          <div class="flex-1">
            <div class="text-sm font-medium">
              {{ $t('settings.general.pendingBankTransactions.label') }}
            </div>
            <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
              {{ $t('settings.general.pendingBankTransactions.description') }}
            </p>
          </div>
          <Switch
            :model-value="importPendingBankTransactions"
            :disabled="isUpdating"
            @update:model-value="handlePendingBankTransactionsToggle"
          />
        </div>

        <Separator />

        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="min-w-48 flex-1">
            <div class="text-sm font-medium">
              {{ $t('settings.general.savingsCategories.label') }}
            </div>
            <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
              {{ $t('settings.general.savingsCategories.description') }}
              <DocsLink path="/stats/how-stats-are-calculated/#savings-categories" />
            </p>
          </div>
          <!-- The field's own root is w-full, so the width lives on a wrapper instead of its class. -->
          <div class="w-64 shrink-0">
            <CategoryMultiSelectField
              :model-value="savingsCategoryIds"
              :disabled="isUpdating"
              @update:model-value="handleSavingsCategoriesChange"
            />
          </div>
        </div>

        <Separator />

        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="min-w-48 flex-1">
            <div class="text-sm font-medium">
              {{ $t('settings.general.taxCategories.label') }}
            </div>
            <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
              {{ $t('settings.general.taxCategories.description') }}
            </p>
          </div>
          <div class="w-64 shrink-0">
            <CategoryMultiSelectField
              :model-value="taxCategoryIds"
              :disabled="isUpdating"
              @update:model-value="handleTaxCategoriesChange"
            />
          </div>
        </div>

        <Separator />

        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="min-w-48 flex-1">
            <div class="text-sm font-medium">
              {{ $t('settings.general.accountDropdowns.defaultAccount.label') }}
            </div>
            <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
              {{ $t('settings.general.accountDropdowns.defaultAccount.description') }}
            </p>
          </div>
          <AccountSelectField
            class="w-64 shrink-0"
            :model-value="defaultAccount"
            :accounts="activeSourceAccounts"
            :placeholder="$t('settings.general.accountDropdowns.defaultAccount.placeholder')"
            :disabled="isDropdownPrefsUpdating"
            clearable
            @update:model-value="handleDefaultAccountChange"
          />
        </div>

        <Separator />

        <div class="flex items-center justify-between gap-4">
          <div class="flex-1">
            <div class="text-sm font-medium">
              {{ $t('settings.general.accountDropdowns.showArchived.label') }}
            </div>
            <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
              {{ $t('settings.general.accountDropdowns.showArchived.description') }}
            </p>
          </div>
          <Switch
            :model-value="showArchivedInDropdowns"
            :disabled="isDropdownPrefsUpdating"
            @update:model-value="handleShowArchivedToggle"
          />
        </div>
        <Separator />

        <div class="flex items-center justify-between gap-4">
          <div class="flex-1">
            <div class="text-sm font-medium">
              {{ $t('settings.general.quickStart.label') }}
            </div>
            <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
              {{ $t('settings.general.quickStart.description') }}
            </p>
          </div>
          <Switch
            :model-value="!isQuickStartDismissed"
            :disabled="!isOnboardingInitialized"
            @update:model-value="handleQuickStartToggle"
          />
        </div>

        <Separator />

        <div class="flex items-center justify-between gap-4">
          <div class="flex-1">
            <div class="text-sm font-medium">
              {{ $t('settings.general.showUpcomingTransactions.label') }}
            </div>
            <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
              {{ $t('settings.general.showUpcomingTransactions.description') }}
            </p>
          </div>
          <Switch
            :model-value="showUpcomingTransactions"
            :disabled="isPatching"
            @update:model-value="handleShowUpcomingToggle"
          />
        </div>

        <Separator />

        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="min-w-48 flex-1">
            <div class="text-sm font-medium">
              {{ $t('settings.general.defaultPaymentType.label') }}
            </div>
            <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
              {{ $t('settings.general.defaultPaymentType.description') }}
            </p>
          </div>
          <div class="w-64 shrink-0">
            <SelectField
              :model-value="defaultPaymentType"
              :values="VERBOSE_PAYMENT_TYPES"
              :label-key="(item) => $t(item.label)"
              :placeholder="$t('settings.general.defaultPaymentType.placeholder')"
              :disabled="isDefaultPaymentTypeUpdating || !userSettings"
              @update:model-value="handleDefaultPaymentTypeChange"
            />
          </div>
        </div>

        <Separator />

        <div class="flex flex-col gap-3">
          <div>
            <div class="text-sm font-medium">
              {{ $t('settings.general.transactionFields.label') }}
            </div>
            <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
              {{ $t('settings.general.transactionFields.description') }}
            </p>
          </div>

          <div class="divide-y rounded-md border">
            <template v-for="field in TRANSACTION_OPTIONAL_FIELDS" :key="field">
              <div class="flex items-center justify-between gap-4 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium">
                    {{ $t(`settings.general.transactionFields.fields.${field}.label`) }}
                  </div>
                  <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
                    {{ $t(`settings.general.transactionFields.fields.${field}.description`) }}
                  </p>
                </div>
                <Switch
                  :model-value="isOptionalFieldEnabled(field)"
                  :disabled="isOptionalFieldsUpdating || !userSettings"
                  @update:model-value="(value) => handleOptionalFieldToggle({ field, value })"
                />
              </div>

              <div
                v-if="field === 'location'"
                class="flex items-center justify-between gap-4 py-3 pr-4 pl-8"
                :class="{ 'opacity-60': !isOptionalFieldEnabled('location') }"
              >
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium">
                    {{ $t('settings.general.transactionFields.mapPicker.label') }}
                  </div>
                  <p class="text-muted-foreground mt-1 text-xs leading-relaxed">
                    {{ $t('settings.general.transactionFields.mapPicker.description') }}
                  </p>
                </div>
                <Switch
                  :model-value="isMapPickerEnabled"
                  :disabled="isMapPickerUpdating || !userSettings || !isOptionalFieldEnabled('location')"
                  @update:model-value="handleMapPickerToggle"
                />
              </div>
            </template>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { VERBOSE_PAYMENT_TYPES, VUE_QUERY_CACHE_KEYS, type VerbosePaymentType } from '@/common/const';
import DocsLink from '@/components/common/docs-link.vue';
import { useDefaultPaymentType } from '@/components/dialogs/manage-transaction/composables/use-default-payment-type';
import { useMapPickerSetting } from '@/components/dialogs/manage-transaction/composables/use-map-picker-setting';
import { useOptionalFields } from '@/components/dialogs/manage-transaction/composables/use-optional-fields';
import AccountSelectField from '@/components/fields/account-select-field.vue';
import CategoryMultiSelectField from '@/components/fields/category-multi-select-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { Separator } from '@/components/lib/ui/separator';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { filterDropdownAccounts, useAccountDropdownPrefs } from '@/composable/use-account-dropdown-prefs';
import { useAccountsStore } from '@/stores';
import { useOnboardingStore } from '@/stores/onboarding';
import { AccountModel, TRANSACTION_OPTIONAL_FIELDS, TransactionOptionalField } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const queryClient = useQueryClient();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { data: userSettings, mutateAsync, isUpdating, patchAsync, isPatching } = useUserSettings();
const { accountsRecord, txTargetableSourceAccountsActiveFirst } = storeToRefs(useAccountsStore());
const onboardingStore = useOnboardingStore();
const { isDismissed: isQuickStartDismissed, isInitialized: isOnboardingInitialized } = storeToRefs(onboardingStore);
const {
  defaultAccountId,
  showArchivedInDropdowns,
  setDefaultAccountId,
  setShowArchivedInDropdowns,
  isUpdating: isDropdownPrefsUpdating,
} = useAccountDropdownPrefs();

const {
  isEnabled: isOptionalFieldEnabled,
  setEnabled: setOptionalField,
  isUpdating: isOptionalFieldsUpdating,
} = useOptionalFields();

const { defaultPaymentType, setDefaultPaymentType, isUpdating: isDefaultPaymentTypeUpdating } = useDefaultPaymentType();

const {
  enabled: isMapPickerEnabled,
  setEnabled: setMapPicker,
  isUpdating: isMapPickerUpdating,
} = useMapPickerSetting();

const includeCreditLimitInStats = computed(() => userSettings.value?.includeCreditLimitInStats ?? false);
const matchTransfersWithManualAccounts = computed(() => userSettings.value?.matchTransfersWithManualAccounts ?? false);
const importPendingBankTransactions = computed(() => userSettings.value?.importPendingBankTransactions ?? false);
const savingsCategoryIds = computed(() => userSettings.value?.savingsCategoryIds ?? []);
const taxCategoryIds = computed(() => userSettings.value?.taxCategoryIds ?? []);
const showUpcomingTransactions = computed(() => !userSettings.value?.ui?.transactionsList?.hideUpcoming);

const defaultAccount = computed<AccountModel | null>(() =>
  defaultAccountId.value ? (accountsRecord.value[defaultAccountId.value] ?? null) : null,
);
const activeSourceAccounts = computed(() =>
  filterDropdownAccounts({ accounts: txTargetableSourceAccountsActiveFirst.value, showArchived: false }),
);

const handleCreditLimitToggle = async (value: boolean) => {
  try {
    await mutateAsync({
      ...userSettings.value,
      includeCreditLimitInStats: value,
    });

    addSuccessNotification(t('settings.general.creditLimit.successNotification'));

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetBalanceTrend] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetBalanceTrendPrev] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetBalanceTotalBalance] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetBalancePreviousBalance] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsBalanceHistoryTrend] }),
    ]);
  } catch {
    addErrorNotification(t('settings.general.creditLimit.errorNotification'));
  }
};

const handleManualTransferMatchingToggle = async (value: boolean) => {
  try {
    await mutateAsync({
      ...userSettings.value,
      matchTransfersWithManualAccounts: value,
    });

    addSuccessNotification(t('settings.general.manualTransferMatching.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.manualTransferMatching.errorNotification'));
  }
};

const handlePendingBankTransactionsToggle = async (value: boolean) => {
  try {
    await mutateAsync({
      ...userSettings.value,
      importPendingBankTransactions: value,
    });

    addSuccessNotification(t('settings.general.pendingBankTransactions.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.pendingBankTransactions.errorNotification'));
  }
};

const handleTaxCategoriesChange = async (value: string[]) => {
  try {
    await mutateAsync({
      ...userSettings.value,
      taxCategoryIds: value,
    });

    addSuccessNotification(t('settings.general.taxCategories.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.taxCategories.errorNotification'));
  }
};

const handleSavingsCategoriesChange = async (value: string[]) => {
  try {
    await mutateAsync({
      ...userSettings.value,
      savingsCategoryIds: value,
    });

    addSuccessNotification(t('settings.general.savingsCategories.successNotification'));

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsCashFlow] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetCashFlow] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetCashFlowPrev] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.widgetCashFlowTrend] }),
      queryClient.invalidateQueries({ queryKey: [...VUE_QUERY_CACHE_KEYS.fireCashFlow] }),
    ]);
  } catch {
    addErrorNotification(t('settings.general.savingsCategories.errorNotification'));
  }
};

const applyDropdownPref = async ({ update }: { update: () => Promise<unknown> }) => {
  try {
    await update();
    addSuccessNotification(t('settings.general.accountDropdowns.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.accountDropdowns.errorNotification'));
  }
};

const handleDefaultAccountChange = (account: AccountModel | null) =>
  applyDropdownPref({ update: () => setDefaultAccountId({ id: account?.id ?? null }) });

const handleShowArchivedToggle = (value: boolean) =>
  applyDropdownPref({ update: () => setShowArchivedInDropdowns({ value }) });

const handleQuickStartToggle = (value: boolean) =>
  value ? onboardingStore.reopen() : onboardingStore.dismissPermanently();

const handleShowUpcomingToggle = async (value: boolean) => {
  try {
    await patchAsync({ ui: { transactionsList: { hideUpcoming: !value } } });
    addSuccessNotification(t('settings.general.showUpcomingTransactions.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.showUpcomingTransactions.errorNotification'));
  }
};

const handleOptionalFieldToggle = async ({ field, value }: { field: TransactionOptionalField; value: boolean }) => {
  try {
    await setOptionalField({ field, value });
    addSuccessNotification(t('settings.general.transactionFields.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.transactionFields.errorNotification'));
  }
};

const handleDefaultPaymentTypeChange = async (item: VerbosePaymentType | null) => {
  if (!item) return;
  try {
    await setDefaultPaymentType({ value: item.value });
    addSuccessNotification(t('settings.general.defaultPaymentType.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.defaultPaymentType.errorNotification'));
  }
};

const handleMapPickerToggle = async (value: boolean) => {
  try {
    await setMapPicker({ value });
    addSuccessNotification(t('settings.general.transactionFields.successNotification'));
  } catch {
    addErrorNotification(t('settings.general.transactionFields.errorNotification'));
  }
};
</script>

<template>
  <SettingRow :label="$t('settings.general.payday.label')" :description="$t('settings.general.payday.description')">
    <SelectField
      :model-value="selectedPayday"
      :values="paydayOptions"
      :placeholder="$t('settings.general.payday.placeholder')"
      :disabled="isPatching || !userSettings"
      class="w-24 shrink-0"
      @update:model-value="handlePaydayChange"
    />
  </SettingRow>
</template>

<script setup lang="ts">
import SelectField from '@/components/fields/select-field.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { CASH_FLOW_PERIOD_STORAGE_KEYS } from '@/pages/analytics/utils';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import SettingRow from './setting-row.vue';

const MAX_PAYDAY = 28;

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const { data: userSettings, patch, isPatching } = useUserSettings();

const paydayOptions = Array.from({ length: MAX_PAYDAY }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
const selectedPayday = computed(() => paydayOptions.find((o) => o.value === (userSettings.value?.payday ?? 1)) ?? null);

const handlePaydayChange = (option: (typeof paydayOptions)[number] | null) => {
  if (!option) return;
  patch(
    { payday: option.value },
    {
      onSuccess: () => {
        CASH_FLOW_PERIOD_STORAGE_KEYS.forEach((key) => sessionStorage.removeItem(key));
        addSuccessNotification(t('settings.general.payday.successNotification'));
      },
    },
  );
};
</script>

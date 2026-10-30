<template>
  <div class="flex flex-col gap-4">
    <SettingRow
      :label="$t('settings.general.unrealizedLossAlert.label')"
      :description="$t('settings.general.unrealizedLossAlert.description')"
    >
      <Switch
        :model-value="config.enabled ?? false"
        :disabled="isPatching"
        @update:model-value="save({ enabled: $event })"
      />
    </SettingRow>

    <template v-if="config.enabled">
      <SettingRow
        :label="$t('settings.general.unrealizedLossAlert.percentLabel')"
        :description="$t('settings.general.unrealizedLossAlert.percentDescription')"
      >
        <InputField
          v-model="percentThreshold"
          type="number"
          only-positive
          :placeholder="String(UNREALIZED_LOSS_ALERT_DEFAULTS.percentThreshold)"
          :disabled="isPatching"
          class="w-28 shrink-0"
          trailing-icon-css-class="px-3"
          @blur="saveThreshold({ key: 'percentThreshold' })"
        >
          <template #iconTrailing>
            <span class="text-muted-foreground text-sm">%</span>
          </template>
        </InputField>
      </SettingRow>

      <SettingRow
        :label="$t('settings.general.unrealizedLossAlert.amountLabel')"
        :description="$t('settings.general.unrealizedLossAlert.amountDescription')"
      >
        <InputField
          v-model="amountThreshold"
          type="number"
          only-positive
          :placeholder="String(UNREALIZED_LOSS_ALERT_DEFAULTS.amountThreshold)"
          :disabled="isPatching"
          class="w-28 shrink-0"
          trailing-icon-css-class="px-3"
          @blur="saveThreshold({ key: 'amountThreshold' })"
        >
          <template #iconTrailing>
            <span class="text-muted-foreground text-sm">{{ baseCurrencyCode }}</span>
          </template>
        </InputField>
      </SettingRow>
    </template>
  </div>
</template>

<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import { Switch } from '@/components/lib/ui/switch';
import { useNotificationCenter } from '@/components/notification-center';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { useCurrenciesStore } from '@/stores';
import {
  UNREALIZED_LOSS_ALERT_DEFAULTS,
  UNREALIZED_LOSS_ALERT_LIMITS,
  type UnrealizedLossAlertsSettings,
} from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import SettingRow from './setting-row.vue';

type ThresholdKey = keyof typeof UNREALIZED_LOSS_ALERT_LIMITS;

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const { data: userSettings, patch, isPatching } = useUserSettings();
const { baseCurrency } = storeToRefs(useCurrenciesStore());

const baseCurrencyCode = computed(() => baseCurrency.value?.currency?.code);
const config = computed<UnrealizedLossAlertsSettings>(() => userSettings.value?.unrealizedLossAlerts ?? {});

const percentThreshold = ref<string | number | null>(null);
const amountThreshold = ref<string | number | null>(null);
const inputs = { percentThreshold, amountThreshold };

const syncInputs = () => {
  percentThreshold.value = config.value.percentThreshold ?? UNREALIZED_LOSS_ALERT_DEFAULTS.percentThreshold;
  amountThreshold.value = config.value.amountThreshold ?? UNREALIZED_LOSS_ALERT_DEFAULTS.amountThreshold;
};
watch(config, syncInputs, { immediate: true });

const save = (update: UnrealizedLossAlertsSettings) =>
  patch(
    { unrealizedLossAlerts: update },
    {
      onSuccess: () => addSuccessNotification(t('settings.general.unrealizedLossAlert.successNotification')),
      onError: syncInputs,
    },
  );

const saveThreshold = ({ key }: { key: ThresholdKey }) => {
  const input = inputs[key];
  const { min, max } = UNREALIZED_LOSS_ALERT_LIMITS[key];
  const value = Number(input.value);
  if (input.value === null || input.value === '' || Number.isNaN(value)) {
    input.value = config.value[key] ?? UNREALIZED_LOSS_ALERT_DEFAULTS[key];
    return;
  }
  const clamped = Math.min(Math.max(value, min), max);
  input.value = clamped;
  if (clamped !== (config.value[key] ?? UNREALIZED_LOSS_ALERT_DEFAULTS[key]))
    save({ [key]: clamped } as UnrealizedLossAlertsSettings);
};
</script>

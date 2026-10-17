<script setup lang="ts">
import FieldLabel from '@/components/fields/components/field-label.vue';
import * as Select from '@/components/lib/ui/select';
import { useCurrencyName } from '@/composable';
import { useCurrenciesStore } from '@/stores';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

// Sentinel: Select requires strings; null (= "use base currency") maps to this value.
// The sentinel cannot collide with a real 3-letter currency code.
const BASE_CURRENCY_VALUE = 'base';

const props = defineProps<{
  modelValue: string | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string | null];
}>();

const { formatCurrencyLabel } = useCurrencyName();
const { baseCurrency, isoCurrenciesVerbose } = storeToRefs(useCurrenciesStore());

const baseCurrencyCode = computed(() => baseCurrency.value?.currencyCode ?? '');

// Map external null → sentinel for the Select; sentinel → null when emitting.
const internalValue = computed(() => props.modelValue ?? BASE_CURRENCY_VALUE);

// Select emits AcceptableValue; all option values here are strings.
const onSelect = (val: unknown) => {
  emit('update:modelValue', val === BASE_CURRENCY_VALUE || val == null ? null : String(val));
};
</script>

<template>
  <div>
    <FieldLabel :label="$t('forms.portfolioSettings.displayCurrencyLabel')">
      <Select.Select :model-value="internalValue" :disabled="disabled" @update:model-value="onSelect">
        <Select.SelectTrigger>
          <Select.SelectValue :placeholder="$t('forms.portfolioSettings.displayCurrencyPlaceholder')" />
        </Select.SelectTrigger>
        <Select.SelectContent>
          <Select.SelectItem :value="BASE_CURRENCY_VALUE">
            {{ $t('forms.portfolioSettings.displayCurrencyBaseOption', { code: baseCurrencyCode }) }}
          </Select.SelectItem>
          <Select.SelectItem v-for="item of isoCurrenciesVerbose.linked" :key="item.code" :value="String(item.code)">
            {{ formatCurrencyLabel({ code: item.code, fallbackName: item.currency }) }}
          </Select.SelectItem>
        </Select.SelectContent>
      </Select.Select>
    </FieldLabel>
    <p class="text-muted-foreground mt-1 text-xs">
      {{ $t('forms.portfolioSettings.displayCurrencyDescription') }}
    </p>
  </div>
</template>

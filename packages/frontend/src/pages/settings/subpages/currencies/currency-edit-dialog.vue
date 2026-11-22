<template>
  <ResponsiveDialog v-model:open="open" :dismissible="!isFormDisabled">
    <template #title>{{ currency.name }}</template>
    <template #description>{{ code }}</template>

    <div class="@container/currencies">
      <RateSourceEditor
        v-if="editableCurrency"
        :currency="currency"
        :is-form-disabled="isFormDisabled"
        @changed="refreshAfterChange"
        @trigger-disabled="isFormDisabled = $event"
      />
      <ExchangeRateForm
        v-else
        :currency="currency"
        :is-form-disabled="isFormDisabled"
        @submit="handleSubmit"
        @trigger-disabled="isFormDisabled = $event"
      />

      <div class="bg-border/60 my-4 h-px w-full" />

      <div class="flex items-center justify-between gap-3">
        <Button
          v-if="editableCurrency"
          variant="outline"
          size="sm"
          class="whitespace-nowrap"
          :disabled="isFormDisabled"
          data-testid="edit-custom-currency"
          @click="openCustomEdit"
        >
          <PencilIcon class="size-4" />
          {{ $t('settings.currencies.row.edit') }}
        </Button>
        <SetBaseCurrency
          v-else
          :currency="currency"
          :is-form-disabled="isFormDisabled"
          @submit="handleSubmit"
          @trigger-disabled="isFormDisabled = $event"
        />
        <DeleteCurrency
          :currency="currency"
          :is-form-disabled="isFormDisabled"
          :is-deletion-disabled="accountsCount > 0"
          @submit="handleSubmit"
          @trigger-disabled="isFormDisabled = $event"
        />
      </div>
    </div>
  </ResponsiveDialog>

  <CustomCurrencyDialog
    v-if="editableCurrency"
    v-model:open="isCustomEditOpen"
    :currency="editableCurrency"
    :accounts-count="accountsCount"
  />
</template>

<script setup lang="ts">
import { pickLogoFields } from '@/components/common/logo-selection';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { PencilIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

import DeleteCurrency from './currency-row/delete-currency.vue';
import ExchangeRateForm from './currency-row/exchange-rate-form.vue';
import SetBaseCurrency from './currency-row/set-base-currency.vue';
import CustomCurrencyDialog from './custom-currency-dialog.vue';
import RateSourceEditor from './rate-source/rate-source-editor.vue';
import { CurrencyWithExchangeRate, EditableCustomCurrency } from './types';
import { useRefreshAfterCurrencyChange } from './use-refresh-after-currency-change';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  accountsCount: number;
}>();

const open = defineModel<boolean>('open', { required: true });

const refreshAfterChange = useRefreshAfterCurrencyChange();

const isFormDisabled = ref(false);

const isCustomEditOpen = ref(false);
const code = computed(() => props.currency.currency?.code ?? '');
const editableCurrency = computed<EditableCustomCurrency | null>(() => {
  const effective = props.currency.currency;
  if (!effective?.isCustom) return null;

  return {
    code: effective.code,
    name: effective.currency,
    symbol: effective.symbol,
    decimals: effective.digits,
    ...pickLogoFields(props.currency),
  };
});

const openCustomEdit = () => {
  open.value = false;
  isCustomEditOpen.value = true;
};

// Closing unmounts the child before it can emit `trigger-disabled: false`.
const handleSubmit = () => {
  isFormDisabled.value = false;
  open.value = false;
  void refreshAfterChange();
};
</script>

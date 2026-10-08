<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import DateField from '@/components/fields/date-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useCurrencyName } from '@/composable';
import { useLinkedCurrencyGroup } from '@/composable/use-linked-currency-group';
import { useCurrenciesStore } from '@/stores';
import { type CurrencyModel, type ExtractedInvoice, TRANSACTION_TYPES } from '@bt/shared/types';
import { format, parseISO } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import InvoiceDirectionToggle from './invoice-direction-toggle.vue';

const props = defineProps<{
  invoice: ExtractedInvoice;
  loading?: boolean;
}>();

const emit = defineEmits<{
  submit: [invoice: ExtractedInvoice];
  cancel: [];
}>();

const transactionType = ref(props.invoice.transactionType);
const vendorName = ref(props.invoice.vendorName);
const customerName = ref(props.invoice.customerName ?? '');

const isIncome = computed(() => transactionType.value === TRANSACTION_TYPES.income);
const totalAmount = ref<string | number | null>(props.invoice.totalAmount);
const { systemCurrencies } = storeToRefs(useCurrenciesStore());
const { formatCurrencyLabel } = useCurrencyName();
const linkedCurrencyGroup = useLinkedCurrencyGroup();
const currencyLabel = (item: CurrencyModel): string =>
  formatCurrencyLabel({ code: item.code, fallbackName: item.currency });

const currency = ref<CurrencyModel | null>(
  systemCurrencies.value.find((item) => item.code === props.invoice.currencyCode) ?? null,
);
// parseISO reads a date-only string as local midnight; `new Date()` reads it as UTC and
// shifts the day west of Greenwich.
const issueDate = ref<Date | undefined>(parseISO(props.invoice.issueDate));

const corrected = computed<ExtractedInvoice | null>(() => {
  const total = Number(totalAmount.value);
  const counterpartyName = isIncome.value ? customerName.value : vendorName.value;
  if (!counterpartyName.trim() || !(total > 0) || !currency.value || !issueDate.value) return null;

  return {
    ...props.invoice,
    transactionType: transactionType.value,
    // Only the counterparty field is on screen, so the other name keeps what the AI read.
    vendorName: vendorName.value.trim() || props.invoice.vendorName,
    customerName: customerName.value.trim() || null,
    totalAmount: total,
    currencyCode: currency.value.code,
    issueDate: format(issueDate.value, 'yyyy-MM-dd'),
  };
});

const submit = () => {
  if (corrected.value) emit('submit', corrected.value);
};
</script>

<template>
  <form class="@container/invoice-form grid gap-4" @submit.prevent="submit">
    <InvoiceDirectionToggle v-model="transactionType" :disabled="loading" />

    <InputField
      v-if="isIncome"
      v-model="customerName"
      :label="$t('dialogs.attachInvoice.form.customer')"
      :placeholder="$t('dialogs.attachInvoice.form.customerPlaceholder')"
      :disabled="loading"
    />
    <InputField
      v-else
      v-model="vendorName"
      :label="$t('dialogs.attachInvoice.form.vendor')"
      :placeholder="$t('dialogs.attachInvoice.form.vendorPlaceholder')"
      :disabled="loading"
    />

    <div class="grid grid-cols-1 gap-4 @sm/invoice-form:grid-cols-2">
      <InputField
        v-model="totalAmount"
        type="number"
        only-positive
        :label="$t('dialogs.attachInvoice.form.total')"
        :placeholder="$t('dialogs.attachInvoice.form.totalPlaceholder')"
        :disabled="loading"
      />
      <SelectField
        v-model="currency"
        :values="systemCurrencies"
        :pinned-group="linkedCurrencyGroup"
        value-key="code"
        :label-key="currencyLabel"
        with-search
        :label="$t('dialogs.attachInvoice.form.currency')"
        :placeholder="$t('dialogs.attachInvoice.form.currencyPlaceholder')"
        :disabled="loading"
      />
    </div>

    <DateField v-model="issueDate" :label="$t('dialogs.attachInvoice.form.issued')" :disabled="loading" />

    <div class="flex justify-end gap-2">
      <Button type="button" variant="secondary" :disabled="loading" @click="emit('cancel')">
        {{ $t('common.actions.cancel') }}
      </Button>
      <Button type="submit" :disabled="!corrected || loading" :loading="loading">
        {{ $t('dialogs.attachInvoice.form.submit') }}
      </Button>
    </div>
  </form>
</template>

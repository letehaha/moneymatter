<script setup lang="ts">
import PickTransactionDialog from '@/components/dialogs/pick-transaction-dialog.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import * as Select from '@/components/lib/ui/select';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { useFormatCurrency } from '@/composable/formatters';
import { TRANSACTION_TYPES, type TransactionModel, VENTURE_CASH_FLOW_MODE, VENTURE_EVENT_TYPE } from '@bt/shared/types';
import { PlusIcon, X } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

const props = defineProps<{
  eventType: VENTURE_EVENT_TYPE;
  currencyCode: string;
  disabled?: boolean;
}>();

const mode = defineModel<VENTURE_CASH_FLOW_MODE>('mode', { required: true });
const transactions = defineModel<TransactionModel[]>('transactions', { required: true });

const isPickerOpen = ref(false);

const isNavOnly = computed(
  () => props.eventType === VENTURE_EVENT_TYPE.nav_update || props.eventType === VENTURE_EVENT_TYPE.writedown,
);

const availableModes = computed(() => {
  if (isNavOnly.value) return [VENTURE_CASH_FLOW_MODE.none];
  return [VENTURE_CASH_FLOW_MODE.linked, VENTURE_CASH_FLOW_MODE.out_of_wallet];
});

watch(
  isNavOnly,
  (navOnly) => {
    if (navOnly) {
      if (mode.value !== VENTURE_CASH_FLOW_MODE.none) mode.value = VENTURE_CASH_FLOW_MODE.none;
    } else if (mode.value === VENTURE_CASH_FLOW_MODE.none) {
      mode.value = VENTURE_CASH_FLOW_MODE.out_of_wallet;
    }
  },
  { immediate: true },
);

const pickerTransactionType = computed(() => {
  if (
    props.eventType === VENTURE_EVENT_TYPE.distribution ||
    props.eventType === VENTURE_EVENT_TYPE.exit ||
    props.eventType === VENTURE_EVENT_TYPE.capital_refund
  ) {
    return TRANSACTION_TYPES.income;
  }
  return TRANSACTION_TYPES.expense;
});

const selectedIds = computed(() => transactions.value.map((tx) => tx.id));

const { formatAmountByCurrencyCode } = useFormatCurrency();
const linkedTotal = computed(() => transactions.value.reduce((sum, tx) => sum + Math.abs(Number(tx.amount)), 0));
const linkedTotalFormatted = computed(() => formatAmountByCurrencyCode(linkedTotal.value, props.currencyCode));

const onPickTransaction = (tx: TransactionModel) => {
  if (transactions.value.some((existing) => existing.id === tx.id)) return;
  transactions.value = [...transactions.value, tx];
};

const removeSelected = (id: TransactionModel['id']) => {
  transactions.value = transactions.value.filter((tx) => tx.id !== id);
};

const cashFlowLabel = (m: VENTURE_CASH_FLOW_MODE): string => `venture.events.cashFlowModes.${m}`;
</script>

<template>
  <div v-if="!isNavOnly" class="grid gap-4">
    <FieldLabel :label="$t('venture.events.form.cashFlowModeLabel')">
      <Select.Select v-model="mode" :disabled="disabled">
        <Select.SelectTrigger>
          <Select.SelectValue />
        </Select.SelectTrigger>
        <Select.SelectContent>
          <Select.SelectItem v-for="m in availableModes" :key="m" :value="m">
            {{ $t(cashFlowLabel(m)) }}
          </Select.SelectItem>
        </Select.SelectContent>
      </Select.Select>
    </FieldLabel>

    <div v-if="mode === VENTURE_CASH_FLOW_MODE.linked" class="grid gap-2">
      <FieldLabel :label="$t('venture.events.form.linkedTransactionsLabel')" :only-template="true">
        <div class="grid gap-2">
          <div v-if="transactions.length > 0" class="grid gap-1">
            <div v-for="tx in transactions" :key="tx.id" class="flex items-center gap-2 rounded-md border px-2 py-1">
              <div class="min-w-0 flex-1">
                <TransactionRecord :tx="tx" :as-button="false" />
              </div>
              <UiButton
                type="button"
                variant="ghost"
                size="icon"
                class="size-8 shrink-0"
                :disabled="disabled"
                :aria-label="$t('venture.events.form.removeLinkedTransaction')"
                @click="removeSelected(tx.id)"
              >
                <X :size="16" />
              </UiButton>
            </div>
          </div>
          <UiButton type="button" variant="outline" class="w-full" :disabled="disabled" @click="isPickerOpen = true">
            <PlusIcon class="size-4" />
            <span>
              {{
                transactions.length === 0
                  ? $t('venture.events.form.pickTransaction')
                  : $t('venture.events.form.pickAnotherTransaction')
              }}
            </span>
          </UiButton>
          <div class="text-muted-foreground text-xs">
            {{
              $t('venture.events.form.linkedSummary', {
                total: linkedTotalFormatted,
                count: transactions.length,
              })
            }}
          </div>
        </div>
      </FieldLabel>
      <PickTransactionDialog
        v-model:open="isPickerOpen"
        :transaction-type="pickerTransactionType"
        :exclude-ids="selectedIds"
        @select="onPickTransaction"
      />
    </div>
  </div>
</template>

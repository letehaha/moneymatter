<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Label } from '@/components/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { useCategoriesStore } from '@/stores';
import { TRANSACTION_TYPES, type RecordId, type TransactionModel } from '@bt/shared/types';
import { CircleCheckIcon, Loader2Icon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useReconciliationActions } from '../use-reconciliation';

const DATE_FORMAT = 'd MMM yyyy, HH:mm';

const props = defineProps<{
  transactions: TransactionModel[];
  defaultSurvivorId?: RecordId;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ merged: [] }>();

const { t } = useI18n();
const { format } = useDateLocale();
const { formatAmountByCurrencyCode } = useFormatCurrency();
const { categoriesMap } = storeToRefs(useCategoriesStore());
const { byId: payeeById } = usePayeeLookup();
const { merge } = useReconciliationActions();

const survivorId = ref<RecordId | null>(null);
watch(open, (value) => {
  if (value) survivorId.value = props.defaultSurvivorId ?? null;
});

const FIELDS: {
  key: 'date' | 'amount' | 'type' | 'category' | 'payee' | 'note' | 'status';
  labelKey: string;
  value: (tx: TransactionModel) => string;
}[] = [
  {
    key: 'date',
    labelKey: 'optimizations.reconciliation.merge.fields.date',
    value: (tx) => format(tx.time, DATE_FORMAT),
  },
  {
    key: 'amount',
    labelKey: 'optimizations.reconciliation.merge.fields.amount',
    value: (tx) => formatAmountByCurrencyCode(tx.amount, tx.currencyCode),
  },
  {
    key: 'type',
    labelKey: 'optimizations.reconciliation.merge.fields.type',
    value: (tx) => t(`optimizations.reconciliation.merge.types.${tx.transactionType}`),
  },
  {
    key: 'category',
    labelKey: 'optimizations.reconciliation.merge.fields.category',
    value: (tx) => categoriesMap.value[tx.categoryId]?.name ?? '—',
  },
  {
    key: 'payee',
    labelKey: 'optimizations.reconciliation.merge.fields.payee',
    value: (tx) => payeeById.value.get(tx.payeeId ?? '')?.name ?? '—',
  },
  {
    key: 'note',
    labelKey: 'optimizations.reconciliation.merge.fields.note',
    value: (tx) => tx.note || '—',
  },
  {
    key: 'status',
    labelKey: 'optimizations.reconciliation.merge.fields.status',
    value: (tx) =>
      tx.isPending
        ? t('optimizations.reconciliation.merge.status.pending')
        : t('optimizations.reconciliation.merge.status.booked'),
  },
];

const differingFields = computed(
  () => new Set(FIELDS.filter((field) => new Set(props.transactions.map(field.value)).size > 1).map((f) => f.key)),
);

const removeCount = computed(() => props.transactions.length - 1);

const confirm = () => {
  if (!survivorId.value) return;
  merge.mutate(
    {
      transactionIds: props.transactions.map((tx) => tx.id),
      survivorId: survivorId.value,
    },
    {
      onSuccess: () => {
        open.value = false;
        emit('merged');
      },
    },
  );
};
</script>

<template>
  <ResponsiveDialog v-model:open="open" dialog-content-class="sm:max-w-3xl">
    <template #title>{{ $t('optimizations.reconciliation.merge.title') }}</template>
    <template #description>{{ $t('optimizations.reconciliation.merge.description') }}</template>

    <div class="@container/merge">
      <RadioGroup v-model="survivorId" class="grid grid-cols-1 gap-3 @lg/merge:grid-cols-2 @2xl/merge:grid-cols-3">
        <Label
          v-for="tx in transactions"
          :key="tx.id"
          :class="
            cn(
              'hover:border-primary/50 cursor-pointer rounded-lg border p-3 font-normal transition-colors',
              survivorId === tx.id && 'border-primary bg-primary/5',
            )
          "
        >
          <div class="mb-2 flex h-5 items-center gap-2 text-xs font-medium">
            <RadioGroupItem :value="tx.id" />
            <span v-if="survivorId === tx.id" class="text-primary-text inline-flex items-center gap-1">
              <CircleCheckIcon class="size-3.5" />
              {{ $t('optimizations.reconciliation.merge.keep') }}
            </span>
            <span v-else-if="survivorId" class="text-destructive-text">
              {{ $t('optimizations.reconciliation.merge.willBeRemoved') }}
            </span>
            <span v-else class="text-muted-foreground">{{ $t('optimizations.reconciliation.merge.pickHint') }}</span>
          </div>

          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <template v-for="field in FIELDS" :key="field.key">
              <dt class="text-muted-foreground">{{ $t(field.labelKey) }}</dt>
              <dd
                :class="
                  cn(
                    'min-w-0 truncate rounded px-1',
                    differingFields.has(field.key) && 'bg-warning-text/10 text-warning-text font-medium',
                    field.key === 'amount' &&
                      !differingFields.has(field.key) &&
                      (tx.transactionType === TRANSACTION_TYPES.income
                        ? 'text-app-income-color'
                        : 'text-app-expense-color'),
                  )
                "
              >
                {{ field.value(tx) }}
              </dd>
            </template>
          </dl>
        </Label>
      </RadioGroup>
    </div>

    <template #footer>
      <Button variant="outline" @click="open = false">{{ $t('common.actions.cancel') }}</Button>
      <Button variant="destructive" :disabled="!survivorId || merge.isPending.value" @click="confirm">
        <Loader2Icon v-if="merge.isPending.value" class="size-4 animate-spin" />
        {{ $t('optimizations.reconciliation.merge.confirm', { count: removeCount }, removeCount) }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>

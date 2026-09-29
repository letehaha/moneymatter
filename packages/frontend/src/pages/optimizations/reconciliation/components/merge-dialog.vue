<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Label } from '@/components/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { RecordId, TransactionModel } from '@bt/shared/types';
import { Loader2Icon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useReconciliationActions } from '../use-reconciliation';

const props = defineProps<{
  transactions: TransactionModel[];
  defaultSurvivorId?: RecordId;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ merged: [] }>();

const { t } = useI18n();
const { format } = useDateLocale();
const { byId: payeeById } = usePayeeLookup();
const { merge } = useReconciliationActions();

const survivorId = ref<RecordId | null>(null);
watch(open, (value) => {
  if (value) survivorId.value = props.defaultSurvivorId ?? null;
});

// Fields TransactionRecord doesn't render: shown once when shared by all, otherwise under each row.
const HIDDEN_FIELDS: {
  key: 'payee' | 'time' | 'status';
  labelKey: string;
  value: (tx: TransactionModel) => string;
  compareBy?: (tx: TransactionModel) => unknown;
}[] = [
  {
    key: 'payee',
    labelKey: 'optimizations.reconciliation.merge.fields.payee',
    value: (tx) => payeeById.value.get(tx.payeeId ?? '')?.name ?? '—',
    compareBy: (tx) => tx.payeeId,
  },
  {
    key: 'time',
    labelKey: 'optimizations.reconciliation.merge.fields.time',
    value: (tx) => format(tx.time, 'HH:mm'),
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

const isShared = ({ field }: { field: (typeof HIDDEN_FIELDS)[number] }) =>
  new Set(props.transactions.map(field.compareBy ?? field.value)).size === 1;
const sharedFields = computed(() => HIDDEN_FIELDS.filter((field) => isShared({ field })));
const differingFields = computed(() => HIDDEN_FIELDS.filter((field) => !isShared({ field })));

const rowDetails = ({ tx }: { tx: TransactionModel }) =>
  differingFields.value
    .filter((field) => field.key !== 'payee' || !tx.note?.toLowerCase().includes(field.value(tx).toLowerCase()))
    .map((field) => ({ key: field.key, labelKey: field.labelKey, value: field.value(tx) }));

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
  <ResponsiveDialog v-model:open="open" dialog-content-class="sm:max-w-xl">
    <template #title>{{ $t('optimizations.reconciliation.merge.title') }}</template>
    <template #description>{{ $t('optimizations.reconciliation.merge.description') }}</template>

    <div class="grid gap-3">
      <div
        v-if="sharedFields.length"
        class="bg-muted text-muted-foreground flex flex-wrap gap-x-3.5 gap-y-1 rounded-md px-3 py-2 text-xs"
      >
        <span>{{ $t('optimizations.reconciliation.merge.sameInAll') }}</span>
        <span v-for="field in sharedFields" :key="field.key">
          {{ $t(field.labelKey) }}
          <span class="text-foreground font-semibold">{{ field.value(transactions[0]!) }}</span>
        </span>
      </div>

      <RadioGroup v-model="survivorId" class="grid gap-3.5 pt-2">
        <Label
          v-for="tx in transactions"
          :key="tx.id"
          :class="
            cn(
              'hover:border-primary/50 relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1 rounded-lg border py-1.5 pr-1.5 pl-3 font-normal transition-colors',
              survivorId === tx.id && 'border-success-text/60 bg-success-text/5 hover:border-success-text/60',
            )
          "
        >
          <span
            v-if="survivorId"
            :class="
              cn(
                'bg-card absolute -top-2.5 right-3 rounded-full border border-current px-1.5 text-[11px] leading-4 font-semibold tracking-wide uppercase',
                survivorId === tx.id ? 'text-success-text' : 'text-destructive-text',
              )
            "
          >
            {{
              survivorId === tx.id
                ? $t('optimizations.reconciliation.merge.keep')
                : $t('optimizations.reconciliation.merge.remove')
            }}
          </span>

          <RadioGroupItem :value="tx.id" />
          <TransactionRecord
            :tx="tx"
            :as-button="false"
            :class="cn('transition-opacity', survivorId && survivorId !== tx.id && 'opacity-60')"
          />

          <p
            v-if="rowDetails({ tx }).length"
            :class="
              cn(
                'text-muted-foreground col-start-2 px-2 pb-0.5 text-xs transition-opacity',
                survivorId && survivorId !== tx.id && 'opacity-60',
              )
            "
          >
            <template v-for="(detail, index) in rowDetails({ tx })" :key="detail.key">
              <span v-if="index > 0" aria-hidden="true"> · </span>
              {{ $t(detail.labelKey) }} <span class="text-foreground font-semibold">{{ detail.value }}</span>
            </template>
          </p>
        </Label>
      </RadioGroup>
    </div>

    <template #footer>
      <Button variant="outline" @click="open = false">{{ $t('common.actions.cancel') }}</Button>
      <Button :disabled="!survivorId || merge.isPending.value" @click="confirm">
        <Loader2Icon v-if="merge.isPending.value" class="size-4 animate-spin" />
        {{ $t('optimizations.reconciliation.merge.confirm', { count: removeCount }, removeCount) }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>

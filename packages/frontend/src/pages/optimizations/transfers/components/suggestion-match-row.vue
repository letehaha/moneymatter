<script setup lang="ts">
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { Button } from '@/components/lib/ui/button';
import { cn } from '@/lib/utils';
import type { TransactionModel, BulkTransferScanMatch } from '@bt/shared/types';
import { EyeOffIcon, LinkIcon, LoaderCircleIcon } from '@lucide/vue';
import { computed } from 'vue';

const props = defineProps<{
  match: BulkTransferScanMatch;
  isLinking: boolean;
  isSkipping: boolean;
}>();

const emit = defineEmits<{
  link: [];
  skip: [];
  'record-click': [value: TransactionModel, oppositeTx: TransactionModel | undefined];
}>();

const CONFIDENCE_HIGH = 75;
const CONFIDENCE_MEDIUM = 50;

function getConfidenceColors(confidence: number): { bg: string; text: string } {
  if (confidence >= CONFIDENCE_HIGH) return { bg: 'bg-success-text', text: 'text-success-text' };
  if (confidence >= CONFIDENCE_MEDIUM) return { bg: 'bg-warning-text', text: 'text-warning-text' };
  return { bg: 'bg-destructive-text', text: 'text-destructive-text' };
}

const isBusy = computed(() => props.isLinking || props.isSkipping);

const confidenceColors = computed(() => getConfidenceColors(props.match.confidence));

function handleRecordClick([tx, oppositeTx]: [TransactionModel, TransactionModel | undefined]) {
  emit('record-click', tx, oppositeTx);
}
</script>

<template>
  <div class="@container/match rounded-md border px-2 py-1">
    <div class="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 @[500px]/match:grid-cols-[auto_1fr_auto]">
      <!-- Transaction: spans full row in narrow, middle column in wide -->
      <div class="col-span-2 min-w-0 @[500px]/match:col-span-1 @[500px]/match:col-start-2">
        <TransactionRecord :tx="match.transaction" @record-click="handleRecordClick" />
      </div>

      <!-- Confidence -->
      <div
        class="ml-2 flex shrink-0 items-center gap-1.5 @[500px]/match:col-start-1 @[500px]/match:row-start-1 @[500px]/match:ml-0"
      >
        <div :class="cn('size-2 rounded-full', confidenceColors.bg)" />
        <span :class="cn('text-xs font-semibold tabular-nums', confidenceColors.text)"> {{ match.confidence }}% </span>
      </div>

      <!-- Actions -->
      <div class="flex shrink-0 justify-end gap-1">
        <Button variant="secondary" size="sm" :disabled="isBusy" class="gap-1.5" @click.stop="$emit('skip')">
          <LoaderCircleIcon v-if="isSkipping" class="size-3.5 animate-spin" />
          <EyeOffIcon v-else class="size-3.5" />

          {{ $t('optimizations.transferSuggestions.skip.action') }}
        </Button>

        <Button variant="outline" size="sm" :disabled="isBusy" class="gap-1.5" @click.stop="$emit('link')">
          <LoaderCircleIcon v-if="isLinking" class="size-3.5 animate-spin" />
          <LinkIcon v-else class="size-3.5" />

          {{ $t('common.actions.link') }}
        </Button>
      </div>
    </div>
  </div>
</template>

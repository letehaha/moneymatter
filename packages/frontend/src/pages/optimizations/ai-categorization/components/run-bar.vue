<script setup lang="ts">
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import AiUsageBadge from '@/components/common/ai-usage/ai-usage-badge.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { AI_CATEGORIZATION_MAX_TRANSACTIONS_PER_RUN, AI_FEATURE } from '@bt/shared/types';
import { Loader2Icon, SparklesIcon, XIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import type { CategorizationRun } from '../use-categorization-run';
import RunSetupPopover from './run-setup-popover.vue';

const props = defineProps<{
  run: CategorizationRun;
  selectedCount: number;
  getSelectedTransactionIds?: () => string[];
}>();

const emit = defineEmits<{ 'clear-selection': [] }>();

const { t } = useI18n();

const {
  totalCount,
  isCountKnown,
  countLabel,
  exceedsRunCap,
  isCategorizing,
  progress,
  processedLabel,
  isBusy,
  isRunDisabled,
  trigger,
} = props.run;

const capLimit = AI_CATEGORIZATION_MAX_TRANSACTIONS_PER_RUN.toLocaleString();

const runLabel = computed(() => {
  if (isBusy.value) return t('optimizations.aiCategorization.run.inProgress');
  if (props.selectedCount > 0)
    return t('optimizations.aiCategorization.run.categorizeSelected', { count: props.selectedCount });
  return t('optimizations.aiCategorization.run.button');
});

const isConfirmOpen = ref(false);

// One run is capped backend-side, so the confirmation states what this run will
// actually touch rather than the whole backlog.
const confirmCount = computed(() => Math.min(totalCount.value ?? 0, AI_CATEGORIZATION_MAX_TRANSACTIONS_PER_RUN));
const confirmCountLabel = computed(() => confirmCount.value.toLocaleString());

const runCategorization = ({ transactionIds }: { transactionIds?: string[] } = {}) => {
  trigger({ transactionIds }, { onSuccess: () => emit('clear-selection') });
};

// An explicit selection already names its scope; only the everything-run asks.
const handleRun = () => {
  const ids = props.selectedCount > 0 ? (props.getSelectedTransactionIds?.() ?? []) : [];
  if (ids.length > 0) {
    runCategorization({ transactionIds: ids });
    return;
  }
  if (isRunDisabled.value) return;
  isConfirmOpen.value = true;
};

const handleConfirmRun = () => {
  isConfirmOpen.value = false;
  runCategorization();
};
</script>

<template>
  <div
    class="@container/runbar relative flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5"
  >
    <!-- The min-w floor is what makes the bar wrap: flex-1 alone gives this group
         a hypothetical size of 0, so it gets crushed instead of dropping a row. -->
    <div class="flex min-w-40 flex-1 items-center gap-2">
      <div v-if="!isCountKnown" class="bg-muted h-4 w-32 animate-pulse rounded" />

      <template v-else-if="isCategorizing">
        <Loader2Icon class="text-primary-text size-4 shrink-0 animate-spin" />
        <span class="min-w-0 truncate text-sm tabular-nums">{{ processedLabel }}</span>
      </template>

      <i18n-t
        v-else-if="selectedCount > 0"
        keypath="transactions.bulkEdit.selectedCount"
        tag="span"
        class="text-muted-foreground min-w-0 truncate text-sm"
      >
        <template #count>
          <span class="text-foreground text-base font-semibold tabular-nums">
            {{ selectedCount.toLocaleString() }}
          </span>
        </template>
      </i18n-t>

      <template v-else>
        <i18n-t
          keypath="optimizations.aiCategorization.bar.uncategorizedCount"
          tag="span"
          class="text-muted-foreground min-w-0 truncate text-sm"
        >
          <template #count>
            <span class="text-foreground text-base font-semibold tabular-nums">{{ countLabel }}</span>
          </template>
        </i18n-t>

        <ResponsiveTooltip
          v-if="exceedsRunCap"
          content-class-name="max-w-75"
          :content="$t('optimizations.aiCategorization.count.capNote', { limit: capLimit })"
        >
          <span class="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs tabular-nums">
            {{ $t('optimizations.aiCategorization.bar.capChip', { limit: capLimit }) }}
          </span>
        </ResponsiveTooltip>

        <!-- flex-1 off a zero basis: the hint only ever takes space the count
             readout left over, so a long count never truncates for a hint. -->
        <span v-else class="text-muted-foreground min-w-0 flex-1 truncate text-sm @max-xl/runbar:hidden">
          {{ $t('optimizations.aiCategorization.table.selectionHint') }}
        </span>
      </template>
    </div>

    <!-- The buttons carry whitespace-nowrap, so at the narrowest widths this group
         must be allowed to wrap or it overflows the card. -->
    <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
      <AiUsageBadge :feature="AI_FEATURE.categorization" />
      <RunSetupPopover />

      <Button size="sm" :disabled="isRunDisabled" @click="handleRun">
        <Loader2Icon v-if="isBusy" class="size-4 animate-spin" />
        <SparklesIcon v-else class="size-4" />
        {{ runLabel }}
      </Button>

      <DesktopOnlyTooltip v-if="selectedCount > 0" :content="$t('transactions.bulkEdit.cancelSelection')">
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="$t('transactions.bulkEdit.cancelSelection')"
          @click="emit('clear-selection')"
        >
          <XIcon class="size-4" />
        </Button>
      </DesktopOnlyTooltip>
    </div>

    <div
      v-if="isCategorizing"
      class="bg-primary/25 absolute inset-x-0 bottom-0 h-1 overflow-hidden"
      role="progressbar"
      :aria-label="$t('optimizations.aiCategorization.run.progressLabel')"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="progress"
    >
      <div class="bg-primary h-full transition-[width] duration-700 ease-out" :style="{ width: `${progress}%` }" />
    </div>

    <ResponsiveAlertDialog
      v-model:open="isConfirmOpen"
      :confirm-label="$t('optimizations.aiCategorization.confirm.action')"
      @confirm="handleConfirmRun"
    >
      <template #title>{{ $t('optimizations.aiCategorization.confirm.title') }}</template>
      <template #description>
        {{ $t('optimizations.aiCategorization.confirm.description', { count: confirmCountLabel }, confirmCount) }}
      </template>
    </ResponsiveAlertDialog>
  </div>
</template>

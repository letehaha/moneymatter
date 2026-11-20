<template>
  <Popover.Popover v-model:open="isOpen">
    <!-- Tooltip only explains the disabled state; the span keeps hover events
         alive when the disabled trigger itself stops emitting them -->
    <DesktopOnlyTooltip :content="$t('transactions.filters.transferNature.disabledTooltip')" :disabled="!isDisabled">
      <span class="flex w-full">
        <Popover.PopoverTrigger
          :disabled="isDisabled"
          :class="
            cn(
              'border-input bg-input-background ring-offset-background focus-visible:ring-ring flex w-full items-center justify-between gap-2 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              controlHeight[size],
            )
          "
        >
          <span class="min-w-0 flex-1 truncate text-left">{{ triggerLabel }}</span>
          <ChevronDownIcon class="text-muted-foreground size-4 shrink-0" />
        </Popover.PopoverTrigger>
      </span>
    </DesktopOnlyTooltip>

    <Popover.PopoverContent
      class="w-(--reka-popover-trigger-width) min-w-48 rounded-md p-1.25"
      align="start"
      :side-offset="4"
    >
      <Button
        v-for="nature in SELECTABLE_TRANSFER_NATURES"
        :key="nature"
        type="button"
        variant="ghost"
        class="h-auto w-full justify-between px-2 py-1 font-normal"
        @click="toggleNature(nature)"
      >
        <span class="truncate">{{ $t(NATURE_LABEL_KEYS[nature]) }}</span>
        <CheckIcon v-if="transferNatures.includes(nature)" class="size-4 shrink-0" />
      </Button>
    </Popover.PopoverContent>
  </Popover.Popover>
</template>

<script lang="ts" setup>
import { Button } from '@/components/lib/ui/button';
import { type ControlSize, controlHeight } from '@/components/lib/ui/control-size';
import * as Popover from '@/components/lib/ui/popover';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { SELECTABLE_TRANSFER_NATURES } from '@/components/records-filters/const';
import { cn } from '@/lib/utils';
import { FILTER_OPERATION, TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { CheckIcon, ChevronDownIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    transferNatures: TRANSACTION_TRANSFER_NATURE[];
    transferFilter: FILTER_OPERATION;
    size?: ControlSize;
  }>(),
  { size: 'default' },
);

const emit = defineEmits<{
  'update:transfer-natures': [value: TRANSACTION_TRANSFER_NATURE[]];
}>();

const { t } = useI18n();

const NATURE_LABEL_KEYS: Record<(typeof SELECTABLE_TRANSFER_NATURES)[number], string> = {
  [TRANSACTION_TRANSFER_NATURE.common_transfer]: 'transactions.filters.transferNature.commonTransfer',
  [TRANSACTION_TRANSFER_NATURE.transfer_out_wallet]: 'transactions.filters.transferNature.outOfWallet',
  [TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio]: 'transactions.filters.transferNature.toPortfolio',
  [TRANSACTION_TRANSFER_NATURE.transfer_to_venture]: 'transactions.filters.transferNature.toVenture',
};

const isOpen = ref(false);

// Narrowing transfer kinds is meaningless when transfers are excluded entirely.
const isDisabled = computed(() => props.transferFilter === FILTER_OPERATION.exclude);

const triggerLabel = computed(() => {
  // All selected = no narrowing — show the filter's name, like an empty combobox.
  if (props.transferNatures.length === SELECTABLE_TRANSFER_NATURES.length) {
    return t('transactions.filters.transferNature.label');
  }
  // find() narrows to the selectable subset — the prop's type also allows
  // not_transfer, which has no label here.
  const single =
    props.transferNatures.length === 1
      ? SELECTABLE_TRANSFER_NATURES.find((nature) => nature === props.transferNatures[0])
      : undefined;
  if (single) return t(NATURE_LABEL_KEYS[single]);
  return t('transactions.filters.transferNature.selectedCount', { n: props.transferNatures.length });
});

const toggleNature = (nature: TRANSACTION_TRANSFER_NATURE) => {
  const next = props.transferNatures.includes(nature)
    ? props.transferNatures.filter((value) => value !== nature)
    : [...props.transferNatures, nature];
  emit('update:transfer-natures', next);
};
</script>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { TrashEntry } from '@bt/shared/types';
import { CalendarClockIcon } from '@lucide/vue';
import { computed } from 'vue';

import { isTrashExpiringSoon } from '../helpers';
import type { TrashEntryDisplay } from '../use-transactions-trash';

const props = defineProps<{
  entry: TrashEntry;
  display: TrashEntryDisplay;
  daysLeft: number;
  /** Left undefined when rows open a sheet instead of toggling a side panel, so `aria-pressed` is omitted. */
  selected?: boolean;
}>();

defineEmits<{ select: [] }>();

const { format } = useDateLocale();
const isSoon = computed(() => isTrashExpiringSoon({ daysLeft: props.daysLeft }));
</script>

<template>
  <Button
    variant="ghost"
    :aria-pressed="selected"
    :class="
      cn(
        'h-auto min-h-16 w-full justify-start gap-3 rounded-none px-4 py-3 text-left font-normal whitespace-normal @lg/trash:gap-4',
        selected && 'bg-primary/10 hover:bg-primary/15 shadow-[inset_3px_0_0_var(--primary)]',
      )
    "
    @click="$emit('select')"
  >
    <span class="flex w-10 flex-none flex-col items-center gap-1 @lg/trash:w-13">
      <span
        :class="cn('text-lg leading-none font-bold tabular-nums @lg/trash:text-2xl', isSoon && 'text-warning-text')"
      >
        {{ daysLeft }}
      </span>
      <span :class="cn('text-xs', isSoon ? 'text-warning-text' : 'text-muted-foreground')">
        {{ $t('transactions.trashPage.daysLeftCaption', daysLeft) }}
      </span>
    </span>

    <span class="flex min-w-0 flex-auto flex-col gap-0.5">
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="truncate font-semibold">{{ display.title }}</span>
        <CalendarClockIcon
          v-if="display.isPlanned"
          class="text-muted-foreground size-3.5 shrink-0"
          role="img"
          :aria-label="$t('transactions.trashPage.plannedLabel')"
        />
      </span>
      <span class="text-muted-foreground truncate text-xs">
        {{ display.categoryLabel }} · {{ display.accountName }}
        <span class="hidden @lg/trash:inline">
          · {{ $t('transactions.trashPage.deletedOn', { date: format(entry.deletedAt, 'd MMM') }) }}
        </span>
      </span>
    </span>

    <span :class="cn('text-amount shrink-0 text-sm font-bold whitespace-nowrap', display.amountClass)">
      {{ display.amountText }}
    </span>
  </Button>
</template>

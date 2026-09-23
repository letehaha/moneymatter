<script setup lang="ts">
import { restoreBudgetPlanLine } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { useDateLocale } from '@/composable/use-date-locale';
import type { BudgetPlanLineEntry } from '@bt/shared/types';
import { ArchiveRestoreIcon, Loader2Icon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { watch } from 'vue';

const props = defineProps<{ planId: string; lines: BudgetPlanLineEntry[] }>();
const isOpen = defineModel<boolean>('open', { required: true });

const { format } = useDateLocale();

const {
  isPending,
  variables,
  mutate: restore,
} = useInvalidatingMutation({
  mutationFn: restoreBudgetPlanLine,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.archivedLines.restored',
  errorKey: 'budgetPlans.archivedLines.restoreError',
});

const isRestoring = ({ lineId }: { lineId: string }) => isPending.value && variables.value?.lineId === lineId;

watch(
  () => props.lines.length,
  (count) => {
    if (!count) isOpen.value = false;
  },
);
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ $t('budgetPlans.archivedLines.title') }}</template>
    <template #description>{{ $t('budgetPlans.archivedLines.description') }}</template>

    <ul class="grid gap-2">
      <li
        v-for="line in lines"
        :key="line.id"
        class="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
      >
        <div class="min-w-0">
          <p class="truncate font-medium">{{ line.name }}</p>
          <p v-if="line.activeUntil" class="text-muted-foreground text-xs">
            {{
              $t('budgetPlans.archivedLines.archivedFrom', { date: format(parseISO(line.activeUntil), 'd MMM yyyy') })
            }}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          class="shrink-0"
          :disabled="isPending"
          :aria-busy="isRestoring({ lineId: line.id })"
          :aria-label="$t('budgetPlans.archivedLines.restoreLine', { name: line.name })"
          @click="restore({ planId, lineId: line.id })"
        >
          <Loader2Icon v-if="isRestoring({ lineId: line.id })" class="size-4 animate-spin" />
          <ArchiveRestoreIcon v-else class="size-4" />
          {{ $t('budgetPlans.archivedLines.restore') }}
        </Button>
      </li>
    </ul>
  </ResponsiveDialog>
</template>

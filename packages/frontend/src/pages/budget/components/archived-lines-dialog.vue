<script setup lang="ts">
import { restoreBudgetPlanLine } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { useDateLocale } from '@/composable/use-date-locale';
import type { BudgetPlanLineEntry } from '@bt/shared/types';
import { ArchiveRestoreIcon, Loader2Icon, Trash2Icon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { ref, watch } from 'vue';

import DeleteLineDialog from './delete-line-dialog.vue';

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

const isDeleteOpen = ref(false);
const deleteTarget = ref<{ lineId: string; name: string } | null>(null);
const askDelete = ({ line }: { line: BudgetPlanLineEntry }) => {
  deleteTarget.value = { lineId: line.id, name: line.name };
  isDeleteOpen.value = true;
};

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

        <div class="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            :disabled="isPending"
            :aria-busy="isRestoring({ lineId: line.id })"
            :aria-label="$t('budgetPlans.archivedLines.restoreLine', { name: line.name })"
            @click="restore({ planId, lineId: line.id })"
          >
            <Loader2Icon v-if="isRestoring({ lineId: line.id })" class="size-4 animate-spin" />
            <ArchiveRestoreIcon v-else class="size-4" />
            {{ $t('budgetPlans.archivedLines.restore') }}
          </Button>
          <DesktopOnlyTooltip :content="$t('budgetPlans.archivedLines.deleteLine', { name: line.name })">
            <Button
              variant="ghost-destructive"
              size="icon"
              class="size-9"
              :disabled="isPending"
              :aria-label="$t('budgetPlans.archivedLines.deleteLine', { name: line.name })"
              @click="askDelete({ line })"
            >
              <Trash2Icon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>
      </li>
    </ul>

    <DeleteLineDialog
      v-model:open="isDeleteOpen"
      :plan-id="planId"
      :line="deleteTarget"
      has-history
      is-archived
      :is-archiving="false"
    />
  </ResponsiveDialog>
</template>

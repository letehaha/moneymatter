<script setup lang="ts">
import { deleteBudgetPlanLine } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { ArchiveIcon } from '@lucide/vue';

const props = defineProps<{
  planId: string;
  line: { lineId: string; name: string } | null;
  hasHistory: boolean;
  isArchiving: boolean;
  isArchived?: boolean;
}>();
const emit = defineEmits<{ archive: [] }>();
const isOpen = defineModel<boolean>('open', { required: true });

const { isPending: isDeleting, mutate: remove } = useInvalidatingMutation({
  mutationFn: deleteBudgetPlanLine,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.line.deleted',
  errorKey: 'budgetPlans.line.deleteError',
  onSuccess: () => {
    isOpen.value = false;
  },
});

const confirmDelete = () => {
  if (!props.line || isDeleting.value) return;
  remove({ planId: props.planId, lineId: props.line.lineId });
};
</script>

<template>
  <ResponsiveAlertDialog
    v-model:open="isOpen"
    :confirm-label="hasHistory ? $t('budgetPlans.grid.deleteLine') : $t('budgetPlans.grid.deletePermanently')"
    confirm-variant="destructive"
    :confirm-disabled="isDeleting || isArchiving"
    @confirm="confirmDelete"
  >
    <template #title>{{ $t('budgetPlans.grid.deleteTitle', { name: line?.name }) }}</template>
    <template #description>
      {{ hasHistory ? $t('budgetPlans.grid.deleteHistoryDescription') : $t('budgetPlans.grid.deleteDescription') }}
    </template>

    <Callout v-if="hasHistory && !isArchived" variant="info">
      <p>{{ $t('budgetPlans.grid.deleteArchiveHint') }}</p>
      <Button variant="outline" size="sm" class="mt-3" :disabled="isDeleting || isArchiving" @click="emit('archive')">
        <ArchiveIcon class="size-4" />
        {{ $t('budgetPlans.grid.archiveLine') }}
      </Button>
    </Callout>
  </ResponsiveAlertDialog>
</template>

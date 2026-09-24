<script setup lang="ts">
import { setBudgetPlanLayout } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import type { BudgetPlanLineEntry, BudgetPlanLineGroup } from '@bt/shared/types';
import { GripVerticalIcon } from '@lucide/vue';
import { ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';

import { type LayoutState, buildLayoutPayload, layoutStateFrom } from '../helpers';

const props = defineProps<{
  planId: string;
  lines: BudgetPlanLineEntry[];
  groups: BudgetPlanLineGroup[];
}>();
const isOpen = defineModel<boolean>('open', { required: true });

const LINES_GROUP = 'budget-layout-lines';
const DRAG_PROPS = { animation: 200, delay: 150, delayOnTouchOnly: true, ghostClass: 'opacity-40' } as const;

const state = ref<LayoutState>({ ungrouped: [], groups: [] });

watch(isOpen, (open) => {
  if (open) state.value = layoutStateFrom({ lines: props.lines, groups: props.groups });
});

const close = () => {
  isOpen.value = false;
};

const { isPending, mutate } = useInvalidatingMutation({
  mutationFn: setBudgetPlanLayout,
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.budgetPlans],
  successKey: 'budgetPlans.groups.layoutSaved',
  errorKey: 'budgetPlans.groups.layoutError',
  onSuccess: close,
});

const save = () => {
  if (isPending.value) return;
  mutate({ planId: props.planId, payload: buildLayoutPayload({ state: state.value }) });
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="sm:max-w-lg">
    <template #title>{{ $t('budgetPlans.groups.layoutTitle') }}</template>
    <template #description>{{ $t('budgetPlans.groups.layoutDescription') }}</template>

    <!-- data-vaul-no-drag keeps the mobile drawer from treating a drag as a swipe to close. -->
    <div class="grid gap-3" data-vaul-no-drag>
      <section class="border-border rounded-lg border border-dashed">
        <h3 class="text-muted-foreground px-3 pt-2 text-xs font-semibold tracking-wide uppercase">
          {{ $t('budgetPlans.groups.ungrouped') }}
        </h3>
        <VueDraggable
          v-model="state.ungrouped"
          :group="LINES_GROUP"
          v-bind="DRAG_PROPS"
          class="flex min-h-10 flex-col gap-0.5 p-1.5"
        >
          <div
            v-for="line in state.ungrouped"
            :key="line.id"
            class="hover:bg-muted/50 flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-sm"
          >
            <GripVerticalIcon class="text-muted-foreground size-4 shrink-0" />
            <span class="min-w-0 truncate">{{ line.name }}</span>
          </div>
        </VueDraggable>
      </section>

      <VueDraggable v-model="state.groups" handle=".group-drag-handle" v-bind="DRAG_PROPS" class="flex flex-col gap-3">
        <section v-for="group in state.groups" :key="group.id" class="border-border rounded-lg border">
          <div class="group-drag-handle bg-muted flex cursor-grab items-center gap-2 rounded-t-lg px-3 py-2">
            <GripVerticalIcon class="text-muted-foreground size-4 shrink-0" />
            <h3 class="min-w-0 truncate text-xs font-semibold tracking-wide uppercase">{{ group.name }}</h3>
          </div>
          <VueDraggable
            v-model="group.lines"
            :group="LINES_GROUP"
            v-bind="DRAG_PROPS"
            class="flex min-h-10 flex-col gap-0.5 p-1.5"
          >
            <div
              v-for="line in group.lines"
              :key="line.id"
              class="hover:bg-muted/50 flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-sm"
            >
              <GripVerticalIcon class="text-muted-foreground size-4 shrink-0" />
              <span class="min-w-0 truncate">{{ line.name }}</span>
            </div>
          </VueDraggable>
        </section>
      </VueDraggable>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="close">{{ $t('common.actions.cancel') }}</Button>
        <Button :disabled="isPending" @click="save">{{ $t('common.actions.save') }}</Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>

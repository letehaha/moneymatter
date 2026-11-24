<script setup lang="ts">
import TextareaField from '@/components/fields/textarea-field.vue';
import { BUDGET_PLAN_NOTE_MAX_LENGTH, type BudgetPlanPeriodViewLine } from '@bt/shared/types';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { useSetNote } from '../composables/use-set-note';
import type { PanelContext } from '../helpers';

const props = defineProps<{ context: PanelContext; line?: BudgetPlanPeriodViewLine }>();

type Target = { periodId: string; lineId?: string };
const currentTarget = (): Target => ({ periodId: props.context.period.id, lineId: props.line?.lineId });
const targetKey = ({ periodId, lineId }: Target) => `${periodId}:${lineId ?? ''}`;

const savedNote = computed(() => (props.line ? props.line.note : props.context.period.note) ?? '');
const draft = ref(savedNote.value);
// The draft has unsaved edits while it differs from this.
let baseline = savedNote.value;

const { mutate } = useSetNote();
const commit = (target: Target) => {
  const note = draft.value.trim();
  if (note === baseline) return;
  const previous = baseline;
  baseline = note;
  mutate(
    { planId: props.context.planId, ...target, payload: { note: note || null } },
    {
      onError: () => {
        if (targetKey(target) === targetKey(currentTarget())) baseline = previous;
      },
    },
  );
};

watch([() => props.context.period.id, () => props.line?.lineId], (_, [periodId, lineId]) => {
  commit({ periodId, lineId });
  draft.value = baseline = savedNote.value;
});
watch(savedNote, (note) => {
  if (draft.value.trim() === baseline) draft.value = baseline = note;
});
onBeforeUnmount(() => commit(currentTarget()));
</script>

<template>
  <TextareaField
    v-model="draft"
    :placeholder="$t('budgetPlans.panel.note.placeholder')"
    :title="$t('budgetPlans.panel.note.label')"
    :maxlength="BUDGET_PLAN_NOTE_MAX_LENGTH"
    @focusout="commit(currentTarget())"
  />
</template>

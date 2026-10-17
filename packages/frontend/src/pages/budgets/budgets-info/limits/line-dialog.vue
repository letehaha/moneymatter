<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import CategoryMultiSelectField from '@/components/fields/category-multi-select-field.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import type { TrackerLineModel } from '@bt/shared/types';
import { XIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';

import { useTrackerLineMutations } from './use-tracker-line-mutations';

const FORM_ID = 'tracker-line-form';

const props = defineProps<{
  budgetId: string;
  line?: TrackerLineModel;
  /** Category trackers only count their own categories, so a hint nudges the user to pick from those. */
  isCategoryTracker?: boolean;
}>();

const open = defineModel<boolean>('open', { required: true });

const { createLine, updateLine } = useTrackerLineMutations({ budgetId: () => props.budgetId });

const form = ref({ name: '', categoryIds: [] as string[], limitAmount: null as number | null });
const isSubmitted = ref(false);

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    isSubmitted.value = false;
    form.value = {
      name: props.line?.name ?? '',
      categoryIds: props.line?.categories.map((category) => category.id) ?? [],
      limitAmount: props.line?.limitAmount ?? null,
    };
  },
  { immediate: true },
);

const isPending = computed(() => createLine.isPending.value || updateLine.isPending.value);
const nameError = computed(() => isSubmitted.value && !form.value.name.trim());
const categoriesError = computed(() => isSubmitted.value && form.value.categoryIds.length === 0);

const handleSubmit = async () => {
  isSubmitted.value = true;
  if (nameError.value || categoriesError.value) return;

  const payload = {
    name: form.value.name.trim(),
    categoryIds: form.value.categoryIds,
    limitAmount: form.value.limitAmount,
  };

  try {
    if (props.line) {
      await updateLine.mutateAsync({ lineId: props.line.id, payload });
    } else {
      await createLine.mutateAsync({ payload });
    }
    open.value = false;
  } catch {
    // Error toast is shown by the mutation.
  }
};
</script>

<template>
  <ResponsiveDialog v-model:open="open">
    <template #title>{{ line ? $t('budgets.lines.dialog.editTitle') : $t('budgets.lines.dialog.addTitle') }}</template>

    <form :id="FORM_ID" class="grid gap-4" @submit.prevent="handleSubmit">
      <InputField
        v-model="form.name"
        :label="$t('budgets.lines.dialog.nameLabel')"
        :placeholder="$t('budgets.lines.dialog.namePlaceholder')"
        :error-message="nameError ? $t('budgets.lines.dialog.nameRequired') : undefined"
        :disabled="isPending"
      />

      <div class="grid gap-1">
        <CategoryMultiSelectField
          v-model="form.categoryIds"
          :label="$t('budgets.lines.dialog.categoriesLabel')"
          :placeholder="$t('budgets.lines.dialog.categoriesPlaceholder')"
          :error-message="categoriesError ? $t('budgets.lines.dialog.categoriesRequired') : undefined"
          :disabled="isPending"
        />
        <p v-if="isCategoryTracker" class="text-muted-foreground text-xs">
          {{ $t('budgets.lines.dialog.categoryTrackerHint') }}
        </p>
      </div>

      <div class="grid gap-1">
        <InputField
          v-model="form.limitAmount"
          type="number"
          only-positive
          :label="$t('budgets.lines.dialog.limitLabel')"
          :placeholder="$t('budgets.lines.dialog.limitPlaceholder')"
          :disabled="isPending"
          trailing-icon-css-class="px-1"
        >
          <template v-if="form.limitAmount !== null" #iconTrailing>
            <DesktopOnlyTooltip :content="$t('budgets.lines.dialog.clearLimit')">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                :aria-label="$t('budgets.lines.dialog.clearLimit')"
                @click="form.limitAmount = null"
              >
                <XIcon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
          </template>
        </InputField>
        <p class="text-muted-foreground text-xs">{{ $t('budgets.lines.dialog.limitHint') }}</p>
      </div>
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="ghost" :disabled="isPending" @click="open = false">
          {{ $t('common.actions.cancel') }}
        </Button>
        <Button type="submit" :form="FORM_ID" :disabled="isPending">
          <template v-if="isPending">{{ $t('common.actions.saving') }}</template>
          <template v-else-if="line">{{ $t('common.actions.save') }}</template>
          <template v-else>{{ $t('budgets.lines.addLine') }}</template>
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>

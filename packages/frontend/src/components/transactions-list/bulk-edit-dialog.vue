<script lang="ts" setup>
import { FormattedCategory } from '@/common/types';
import TagIcon from '@/components/common/icons/tag-icon.vue';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import CategorySelectField from '@/components/fields/category-select-field.vue';
import PayeeSelectField from '@/components/fields/payee-select-field.vue';
import TagSelectField from '@/components/fields/tag-select-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import { useAutoTagApply } from '@/composable/use-auto-tag-apply';
import { Button } from '@/components/lib/ui/button';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { useCategoriesStore, useTagsStore } from '@/stores';
import { TagModel, type RecordId, type BulkUpdateTagMode } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { computed, reactive, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

type TagMode = BulkUpdateTagMode;

export interface BulkEditFormValues {
  categoryId?: RecordId;
  tagIds?: string[];
  tagMode?: TagMode;
  note?: string;
  payeeId?: RecordId;
}

const props = defineProps<{
  open: boolean;
  selectedCount: number;
  isLoading: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  apply: [values: BulkEditFormValues];
}>();

const { t } = useI18n();
const { formattedCategories } = storeToRefs(useCategoriesStore());
const tagsStore = useTagsStore();
const { tags } = storeToRefs(tagsStore);
tagsStore.loadTags();

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

const form = reactive({
  category: null as FormattedCategory | null,
  tagIds: [] as string[],
  tagMode: 'add' as TagMode,
  note: '',
  payeeId: null as string | null,
});

const isConfirmDialogOpen = ref(false);

// Picking a payee pre-fills its default tags into the tag field (the user
// can still adjust them and the mode before applying). Same dual-set model
// as the transaction form — see `useAutoTagApply`.
const { apply: applyAutoTags, reset: resetAutoTagTracking } = useAutoTagApply({
  tagIds: toRef(form, 'tagIds'),
  sources: { payee: () => form.payeeId },
});
const handlePayeeSelected = ({ defaultTagIds }: { defaultTagIds: string[] }) => {
  applyAutoTags({ source: 'payee', autoTagIds: defaultTagIds });
};

const resetForm = () => {
  form.category = null;
  form.tagIds = [];
  form.tagMode = 'add';
  form.note = '';
  form.payeeId = null;
  resetAutoTagTracking();
};

watch(isOpen, (open) => {
  if (open) {
    resetForm();
  }
});

const hasCategory = computed(() => form.category !== null);
const hasTags = computed(() => form.tagIds.length > 0);
// A payee can refill the tags later, and they must not inherit a Replace or Remove chosen for earlier tags.
watch(hasTags, (value) => {
  if (!value) form.tagMode = 'add';
});
const hasNote = computed(() => form.note.trim().length > 0);
const hasPayee = computed(() => form.payeeId !== null);

const hasAnyChanges = computed(() => hasCategory.value || hasTags.value || hasNote.value || hasPayee.value);

// Need the Payee name in the confirm dialog summary; resolve from the full payee
// lookup so a payee past the picker's top-50 list still shows its name.
const { byId: payeesById } = usePayeeLookup();
const selectedPayeeName = computed(() => {
  if (!form.payeeId) return '';
  return payeesById.value.get(form.payeeId)?.name ?? '';
});

const isApplyDisabled = computed(() => {
  if (props.isLoading) return true;
  if (props.selectedCount === 0) return true;
  return !hasAnyChanges.value;
});

const selectedTags = computed(() => {
  return form.tagIds
    .map((id) => tags.value.find((tag) => tag.id === id))
    .filter((tag): tag is TagModel => tag !== undefined);
});

const truncatedNote = computed(() => {
  if (!hasNote.value) return '';
  return form.note.length > 50 ? form.note.slice(0, 50) + '...' : form.note;
});

const handleApplyClick = () => {
  isConfirmDialogOpen.value = true;
};

const tagModeLabel = computed(() => {
  const labels: Record<TagMode, string> = {
    add: t('transactions.bulkEdit.tagModeAdd'),
    replace: t('transactions.bulkEdit.tagModeReplace'),
    remove: t('transactions.bulkEdit.tagModeRemove'),
  };
  return labels[form.tagMode];
});

const tagModeItems = computed(
  () =>
    [
      { value: 'add', label: t('transactions.bulkEdit.tagModeAddShort') },
      { value: 'replace', label: t('transactions.bulkEdit.tagModeReplaceShort') },
      { value: 'remove', label: t('transactions.bulkEdit.tagModeRemoveShort') },
    ] satisfies { value: TagMode; label: string }[],
);

const tagModeHint = computed(() => {
  const hints: Record<TagMode, string> = {
    add: t('transactions.bulkEdit.tagModeAddHint'),
    replace: t('transactions.bulkEdit.tagModeReplaceHint'),
    remove: t('transactions.bulkEdit.tagModeRemoveHint'),
  };
  return hints[form.tagMode];
});

const handleConfirmedApply = () => {
  const values: BulkEditFormValues = {};

  if (hasCategory.value) {
    values.categoryId = form.category!.id;
  }
  if (hasTags.value) {
    values.tagIds = form.tagIds;
    values.tagMode = form.tagMode;
  }
  if (hasNote.value) {
    values.note = form.note.trim();
  }
  if (hasPayee.value) {
    values.payeeId = form.payeeId as RecordId;
  }

  emit('apply', values);
  isConfirmDialogOpen.value = false;
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>
      {{ t('transactions.bulkEdit.dialogTitle', { count: selectedCount }) }}
    </template>

    <template #description>
      {{ t('transactions.bulkEdit.dialogDescription') }}
    </template>

    <form class="mt-4 grid gap-4" @submit.prevent="handleApplyClick">
      <CategorySelectField
        v-model="form.category"
        :label="t('transactions.bulkEdit.categoryLabel')"
        :values="formattedCategories"
        :placeholder="t('transactions.bulkEdit.categoryPlaceholder')"
      />

      <PayeeSelectField
        v-model="form.payeeId"
        :label="t('transactions.bulkEdit.payeeLabel')"
        :placeholder="t('transactions.bulkEdit.payeePlaceholder')"
        @payee-selected="handlePayeeSelected"
      />

      <div class="grid gap-1.5">
        <TagSelectField
          v-model="form.tagIds"
          :label="t('transactions.bulkEdit.tagsLabel')"
          :placeholder="t('transactions.bulkEdit.tagsPlaceholder')"
        >
          <template #label-right>
            <PillTabs
              role="group"
              :aria-label="t('transactions.bulkEdit.tagModeLabel')"
              :model-value="form.tagMode"
              :items="tagModeItems"
              :disabled="!hasTags"
              size="sm"
              @update:model-value="(value) => (form.tagMode = value as TagMode)"
            />
          </template>
        </TagSelectField>

        <p v-if="hasTags" class="text-muted-foreground text-sm">
          {{ tagModeHint }}
        </p>
      </div>

      <TextareaField
        v-model="form.note"
        :label="t('transactions.bulkEdit.noteLabel')"
        :placeholder="t('transactions.bulkEdit.notePlaceholder')"
      />

      <div class="mt-2 flex justify-end">
        <Button type="submit" :disabled="isApplyDisabled">
          {{ isLoading ? t('transactions.bulkEdit.applyingButton') : t('transactions.bulkEdit.applyButton') }}
        </Button>
      </div>
    </form>
  </ResponsiveDialog>

  <!-- Confirmation Dialog -->
  <ResponsiveAlertDialog
    v-model:open="isConfirmDialogOpen"
    :cancel-label="t('transactions.bulkEdit.cancelButton')"
    :confirm-label="t('transactions.bulkEdit.confirmApplyButton')"
    @confirm="handleConfirmedApply"
  >
    <template #title>{{ t('transactions.bulkEdit.confirmTitle') }}</template>
    <template #description>
      <p class="mb-3">
        {{ t('transactions.bulkEdit.confirmDescription', { count: selectedCount }) }}
      </p>
      <ul class="space-y-2 text-left">
        <li v-if="hasCategory" class="flex items-center gap-2">
          <span class="text-muted-foreground">{{ t('transactions.bulkEdit.confirmCategoryLabel') }}:</span>
          <span class="font-medium">{{ form.category?.name }}</span>
        </li>
        <li v-if="hasPayee" class="flex items-center gap-2">
          <span class="text-muted-foreground">{{ t('transactions.bulkEdit.confirmPayeeLabel') }}:</span>
          <span class="font-medium">{{ selectedPayeeName }}</span>
        </li>
        <li v-if="hasTags" class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="text-muted-foreground">{{ t('transactions.bulkEdit.confirmTagsLabel') }}:</span>
            <span class="text-muted-foreground text-sm">({{ tagModeLabel }})</span>
          </div>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="tag in selectedTags"
              :key="tag.id"
              class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
              :style="{ backgroundColor: tag.color }"
            >
              <TagIcon v-if="tag.icon" :name="tag.icon" class="size-3" />
              {{ tag.name }}
            </span>
          </div>
        </li>
        <li v-if="hasNote" class="flex items-start gap-2">
          <span class="text-muted-foreground shrink-0">{{ t('transactions.bulkEdit.confirmNoteLabel') }}:</span>
          <span class="italic">"{{ truncatedNote }}"</span>
        </li>
      </ul>
    </template>
  </ResponsiveAlertDialog>
</template>

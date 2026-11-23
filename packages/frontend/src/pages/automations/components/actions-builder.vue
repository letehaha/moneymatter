<script setup lang="ts">
import ResponsiveMenu from '@/components/common/responsive-menu.vue';
import CategorySelectField from '@/components/fields/category-select-field.vue';
import InputField from '@/components/fields/input-field.vue';
import PayeeSelectField from '@/components/fields/payee-select-field.vue';
import TagSelectField from '@/components/fields/tag-select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useCategoriesStore } from '@/stores';
import { findFormattedCategoryById } from '@/stores/categories/helpers';
import {
  AUTOMATION_LIMITS,
  AUTOMATION_NOTE_MODES,
  type AutomationActionType,
  type AutomationNoteMode,
  type RecordId,
} from '@bt/shared/types';
import { PlusIcon, Trash2Icon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { ACTION_DEFAULTS, ACTION_TYPES, type AutomationActionDraft } from './condition-registry';
import FieldError from '@/components/fields/components/field-error.vue';

const props = defineProps<{ modelValue: AutomationActionDraft[]; errors: (string | null)[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: AutomationActionDraft[]] }>();

const { t } = useI18n();
const { formattedCategories, categoriesMap } = storeToRefs(useCategoriesStore());

const isMenuOpen = ref(false);

/** Width per field once the row no longer folds: one choice stays fixed, growable fields grow to a cap. */
const FIELD_WIDTH: Record<Exclude<AutomationActionType, 'exclude_from_stats'>, string> = {
  set_category: '@xl/action:w-72',
  set_payee: '@xl/action:w-72',
  add_tags: '@xl/action:flex-1 @xl/action:max-w-xl',
  set_note: '@xl/action:flex-1 @xl/action:max-w-xl',
};

const availableTypes = computed(() => {
  const used = new Set(props.modelValue.map((action) => action.type));
  return ACTION_TYPES.filter((type) => !used.has(type));
});

const noteModeTabs = computed(() =>
  AUTOMATION_NOTE_MODES.map((mode) => ({ value: mode, label: t(`automations.actions.noteMode.${mode}`) })),
);

const replaceAt = ({ index, action }: { index: number; action: AutomationActionDraft }) =>
  emit(
    'update:modelValue',
    props.modelValue.map((item, i) => (i === index ? action : item)),
  );

const removeAt = ({ index }: { index: number }) =>
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  );

const addAction = ({ type, close }: { type: AutomationActionType; close: () => void }) => {
  close();
  emit('update:modelValue', [...props.modelValue, ACTION_DEFAULTS[type]()]);
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="modelValue.length" class="border-border divide-border divide-y rounded-lg border">
      <div v-for="(action, index) in modelValue" :key="action.type" class="@container/action p-3">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 @xl/action:flex-nowrap">
          <span class="shrink-0 text-sm font-medium">{{ $t(`automations.actions.${action.type}`) }}</span>

          <div
            v-if="action.type !== 'exclude_from_stats'"
            :class="['order-last w-full min-w-0 @xl/action:order-0', FIELD_WIDTH[action.type]]"
          >
            <CategorySelectField
              v-if="action.type === 'set_category'"
              :model-value="
                action.categoryId ? findFormattedCategoryById(formattedCategories, action.categoryId) : null
              "
              :values="formattedCategories"
              :categories-map="categoriesMap"
              :placeholder="$t('automations.editor.categoryPlaceholder')"
              @update:model-value="
                (selected) => replaceAt({ index, action: { ...action, categoryId: selected?.id ?? null } })
              "
            />

            <PayeeSelectField
              v-else-if="action.type === 'set_payee'"
              :model-value="action.payeeId"
              :placeholder="$t('automations.editor.payeePlaceholder')"
              @update:model-value="
                (payeeId) => replaceAt({ index, action: { ...action, payeeId: payeeId as RecordId | null } })
              "
            />

            <TagSelectField
              v-else-if="action.type === 'add_tags'"
              :model-value="action.tagIds"
              :placeholder="$t('automations.editor.tagsPlaceholder')"
              @update:model-value="
                (tagIds) => replaceAt({ index, action: { ...action, tagIds: tagIds as RecordId[] } })
              "
            />

            <div v-else-if="action.type === 'set_note'" class="flex flex-wrap items-center gap-2">
              <PillTabs
                size="sm"
                :items="noteModeTabs"
                :model-value="action.mode"
                @update:model-value="
                  (mode) => replaceAt({ index, action: { ...action, mode: mode as AutomationNoteMode } })
                "
              />
              <InputField
                :model-value="action.value"
                :maxlength="AUTOMATION_LIMITS.maxNoteLength"
                class="min-w-40 flex-1"
                :placeholder="$t('automations.editor.notePlaceholder')"
                @update:model-value="(value) => replaceAt({ index, action: { ...action, value: String(value ?? '') } })"
              />
            </div>
          </div>

          <DesktopOnlyTooltip :content="$t('automations.editor.removeAction')">
            <Button
              type="button"
              variant="soft-destructive"
              size="icon"
              class="ml-auto shrink-0"
              :aria-label="$t('automations.editor.removeAction')"
              @click="removeAt({ index })"
            >
              <Trash2Icon class="size-3.5" />
            </Button>
          </DesktopOnlyTooltip>
        </div>

        <FieldError :error-message="errors[index]" class="mt-2" />
      </div>
    </div>

    <ResponsiveMenu v-model:open="isMenuOpen">
      <template #trigger>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="self-start border-dashed"
          :disabled="availableTypes.length === 0"
        >
          <PlusIcon class="size-4" />
          {{ $t('automations.editor.addAction') }}
        </Button>
      </template>

      <template #default="{ close }">
        <Button
          v-for="type in availableTypes"
          :key="type"
          variant="ghost"
          size="sm"
          class="w-full justify-start"
          @click="addAction({ type, close })"
        >
          {{ $t(`automations.actions.${type}`) }}
        </Button>
      </template>
    </ResponsiveMenu>
  </div>
</template>

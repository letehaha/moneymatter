<script setup lang="ts">
import CategoryMultiSelectField from '@/components/fields/category-multi-select-field.vue';
import TagSelectField from '@/components/fields/tag-select-field.vue';
import { Label } from '@/components/lib/ui/label';
import { Switch } from '@/components/lib/ui/switch';
import { ZapIcon } from '@lucide/vue';
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';

import { type TrackerRulesValues, isTrackerRulesIncomplete } from '../build-tracker-payload';

const props = defineProps<{
  isStoredOn?: boolean;
  showErrors?: boolean;
  disabled?: boolean;
}>();
const model = defineModel<TrackerRulesValues>({ required: true });

const { t } = useI18n();
const switchId = useId();
const cleanupId = useId();

const switchHint = computed(() => {
  if (model.value.rulesEnabled) return t('budgets.rules.switchHintOn');
  return props.isStoredOn ? t('budgets.rules.switchHintTurnedOff') : t('budgets.rules.switchHintOff');
});
const rulesError = computed(() =>
  props.showErrors && isTrackerRulesIncomplete({ values: model.value })
    ? t('budgets.rules.needsCategoryOrTag')
    : undefined,
);
</script>

<template>
  <div class="grid gap-3 border-t pt-4">
    <div class="text-primary-text flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
      <ZapIcon class="size-3.5" />
      {{ $t('budgets.rules.heading') }}
    </div>

    <div class="flex items-start justify-between gap-4">
      <div class="grid gap-0.5">
        <Label :for="switchId">{{ $t('budgets.rules.switchLabel') }}</Label>
        <p class="text-muted-foreground text-xs">{{ switchHint }}</p>
      </div>
      <Switch :id="switchId" v-model="model.rulesEnabled" :disabled="disabled" />
    </div>

    <template v-if="model.rulesEnabled">
      <CategoryMultiSelectField
        v-model="model.categoryIds"
        :label="$t('budgets.rules.categoriesLabel')"
        :placeholder="$t('budgets.rules.categoriesPlaceholder')"
        :disabled="disabled"
      />
      <TagSelectField
        v-model="model.tagIds"
        :label="$t('budgets.rules.tagsLabel')"
        :placeholder="$t('budgets.rules.tagsPlaceholder')"
        :error-message="rulesError"
        :disabled="disabled"
      />

      <div class="flex items-start justify-between gap-4">
        <div class="grid gap-0.5">
          <Label :for="cleanupId">{{ $t('budgets.rules.cleanupLabel') }}</Label>
          <p class="text-muted-foreground text-xs">{{ $t('budgets.rules.cleanupHint') }}</p>
        </div>
        <Switch :id="cleanupId" v-model="model.rulesCleanup" :disabled="disabled" />
      </div>
    </template>

    <slot />
  </div>
</template>

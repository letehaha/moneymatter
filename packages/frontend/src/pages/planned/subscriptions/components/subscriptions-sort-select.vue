<script setup lang="ts">
import * as Select from '@/components/lib/ui/select';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { SUBSCRIPTION_SORT_KEYS, type SubscriptionSortKey } from '../utils';

defineProps<{ modelValue: SubscriptionSortKey }>();

const emit = defineEmits<{ 'update:modelValue': [value: SubscriptionSortKey] }>();

const { t } = useI18n();

const options = computed(() => [
  { value: SUBSCRIPTION_SORT_KEYS.dueDate, label: t('planned.subscriptions.sort.dueDate') },
  { value: SUBSCRIPTION_SORT_KEYS.amount, label: t('planned.subscriptions.sort.amount') },
  { value: SUBSCRIPTION_SORT_KEYS.name, label: t('planned.subscriptions.sort.name') },
  { value: SUBSCRIPTION_SORT_KEYS.recent, label: t('planned.subscriptions.sort.recent') },
]);

const onChange = (value: unknown) => {
  if (value) emit('update:modelValue', value as SubscriptionSortKey);
};
</script>

<template>
  <Select.Select :model-value="modelValue" @update:model-value="onChange">
    <Select.SelectTrigger size="sm" class="w-auto gap-2" :aria-label="$t('planned.subscriptions.sort.ariaLabel')">
      <span class="text-muted-foreground shrink-0">{{ $t('planned.subscriptions.sort.label') }}</span>
      <Select.SelectValue class="max-xs:hidden" />
    </Select.SelectTrigger>
    <Select.SelectContent align="end">
      <Select.SelectItem v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </Select.SelectItem>
    </Select.SelectContent>
  </Select.Select>
</template>

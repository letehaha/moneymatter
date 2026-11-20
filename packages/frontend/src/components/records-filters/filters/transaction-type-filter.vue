<template>
  <SelectField
    :model-value="selectedOption"
    :values="options"
    :placeholder="$t('transactions.filters.transactionType.label')"
    :size="size"
    @update:model-value="onUpdate"
  />
</template>

<script lang="ts" setup>
import SelectField from '@/components/fields/select-field.vue';
import { type ControlSize } from '@/components/lib/ui/control-size';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { type PropType, computed } from 'vue';
import { useI18n } from 'vue-i18n';

// Sentinel for "no type narrowing": select-field treats a null modelValue as
// "nothing picked" (shows the placeholder), so the all-types option needs a real value.
const ALL_TYPES = 'all';

interface TypeOption {
  value: string;
  label: string;
}

const props = defineProps({
  value: {
    type: String,
    default: null,
  },
  size: {
    type: String as PropType<ControlSize>,
  },
});

const emit = defineEmits(['update:value']);

const { t } = useI18n();

const options = computed<TypeOption[]>(() => [
  { value: ALL_TYPES, label: t('transactions.filters.transactionType.allTypes') },
  { value: TRANSACTION_TYPES.income, label: t('transactions.filters.transactionType.income') },
  { value: TRANSACTION_TYPES.expense, label: t('transactions.filters.transactionType.expense') },
]);

const selectedOption = computed(() => options.value.find((option) => option.value === (props.value ?? ALL_TYPES))!);

const onUpdate = (option: TypeOption | null) => {
  emit('update:value', option && option.value !== ALL_TYPES ? option.value : null);
};
</script>

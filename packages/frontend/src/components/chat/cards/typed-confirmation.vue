<script setup lang="ts">
import InputField from '@/components/fields/input-field.vue';
import { computed } from 'vue';

const props = defineProps<{
  modelValue: string;
  /** The affected count the user has to type. */
  expected: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const typed = computed(() => props.modelValue.trim());
const isMismatch = computed(() => typed.value !== '' && typed.value.toLowerCase() !== props.expected.toLowerCase());
</script>

<template>
  <InputField
    :model-value="modelValue"
    :label="$t('chat.cards.typed.label', { phrase: expected })"
    :placeholder="$t('chat.cards.typed.placeholder')"
    :error-message="isMismatch ? $t('chat.cards.typed.mismatch') : undefined"
    @update:model-value="emit('update:modelValue', String($event ?? ''))"
  />
</template>

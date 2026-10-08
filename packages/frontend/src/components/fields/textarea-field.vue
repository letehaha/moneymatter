<template>
  <div class="relative w-full flex-1">
    <FieldLabel :label="label">
      <template #label-right>
        <template v-if="$slots['label-right']">
          <slot name="label-right" />
        </template>
      </template>

      <textarea
        ref="textareaRef"
        :class="
          cn(
            'border-input bg-input-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex max-h-48 w-full resize-none rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
            $attrs.class ?? '',
          )
        "
        :placeholder="placeholder || ''"
        :value="modelValue"
        :disabled="disabled"
        :name="name"
        :autofocus="autofocus"
        :maxlength="maxlength"
        :required="required"
        :readonly="readonly"
        :title="title"
        :rows="rows"
        :cols="cols"
        @input="onInput"
      />
    </FieldLabel>

    <span v-if="maxlength" class="text-muted-foreground mt-1 block text-right text-xs">
      {{ `${currentLength}/${maxlength}` }}
    </span>

    <FieldError :error-message="errorMessage" />
  </div>
</template>

<script lang="ts" setup>
import FieldError from '@/components/fields/components/field-error.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import { cn } from '@/lib/utils';
import { computed, nextTick, onMounted, ref, watch } from 'vue';

const MODEL_EVENTS = Object.freeze({
  input: 'update:modelValue',
});

const emit = defineEmits<{
  (e: 'update:modelValue', payload: string | number): void;
}>();

const props = withDefaults(
  defineProps<{
    label?: string;
    modelValue?: string | number;
    errorMessage?: string;
    // proxies
    autocomplete?: string;
    autofocus?: boolean;
    disabled?: boolean;
    name?: string;
    placeholder?: string;
    required?: boolean;
    readonly?: boolean;
    title?: string;
    maxlength?: string | number;
    // textarea proxies
    rows?: string | number;
    cols?: string | number;
  }>(),
  {
    label: undefined,
    autocomplete: 'off',
    autofocus: false,
    rows: 2,
    modelValue: '',
    errorMessage: undefined,
    name: undefined,
    placeholder: undefined,
    title: undefined,
    maxlength: undefined,
    cols: undefined,
  },
);

const currentLength = computed(() => String(props.modelValue ?? '').length);

const textareaRef = ref<HTMLTextAreaElement | null>(null);

// scrollHeight excludes the border but the border-box height includes it, so the
// offsetHeight/clientHeight delta goes back on top or the field stays scrollable.
const resize = () => {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
};

onMounted(resize);
// Programmatic writes reach the DOM a tick later; user input resizes synchronously in onInput.
watch(
  () => props.modelValue,
  () => nextTick(resize),
);

const onInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  emit(MODEL_EVENTS.input, target.value);
  resize();
};
</script>

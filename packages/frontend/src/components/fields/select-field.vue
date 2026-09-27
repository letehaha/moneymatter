<script lang="ts" setup generic="T extends Record<string, any>">
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import * as Select from '@/components/lib/ui/select';
import { cn } from '@/lib/utils';
import { debounce } from 'lodash-es';
import { XIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import FieldError from './components/field-error.vue';
import FieldLabel from './components/field-label.vue';
import { type SelectPinnedGroup, buildSelectSections } from './utils/select-sections';

const { t } = useI18n();

type StringOrNumberKeys<T> = {
  [P in keyof T]: T[P] extends string | number ? P : never;
}[keyof T];
type NonEmptyArray<T> = [T, ...T[]];

const props = withDefaults(
  defineProps<{
    modelValue: T | null;
    values: T[];
    labelKey?: keyof T | ((value: T) => string) | 'label';
    valueKey?: keyof T | ((value: T) => string | number) | 'value';
    withSearch?: boolean;
    searchKeys?: NonEmptyArray<StringOrNumberKeys<T>>;
    placeholder?: string;
    disabled?: boolean;
    /** Predicate to render an individual option as non-selectable. */
    optionDisabled?: (value: T) => boolean;
    errorMessage?: string;
    label?: string;
    /** When true and a value is selected, renders a clear button that emits update:modelValue with null. */
    clearable?: boolean;
    /** When true, appends a destructive asterisk to the label and sets aria-required on the trigger. */
    required?: boolean;
    /** Lists the matching options first under their own label; a search shows one flat list. */
    pinnedGroup?: SelectPinnedGroup<T>;
  }>(),
  {
    placeholder: undefined,
    disabled: false,
    withSearch: false,
    searchKeys: undefined,
    optionDisabled: undefined,
    errorMessage: undefined,
    labelKey: 'label',
    valueKey: 'value',
    label: undefined,
    clearable: false,
    required: false,
    pinnedGroup: undefined,
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: T | null];
}>();

const searchQuery = ref('');
const selectedValue = computed(() => props.modelValue);
const debouncedFilteredValues = ref<T[]>(props.values);

// reka-ui's SelectContent renders its slot into a detached DocumentFragment
// even while the dropdown is closed (so the trigger can resolve item labels
// natively). With large `values` arrays every closed select pays the full
// mount cost of all SelectItems. The trigger label here is resolved manually
// via `displayItem`, so the hidden items are dead weight — defer rendering
// options (and the search header) until the dropdown opens for the first time.
const hasOpened = ref(false);
const isOpen = ref(false);

function onOpenChange(open: boolean) {
  isOpen.value = open;
  if (open) hasOpened.value = true;
}

defineExpose({ open: () => onOpenChange(true) });

const renderedValues = computed(() => (hasOpened.value ? debouncedFilteredValues.value : []));

const isFiltered = ref(false);
const sections = computed(() =>
  buildSelectSections({
    items: renderedValues.value as T[],
    pinnedGroup: isFiltered.value ? undefined : props.pinnedGroup,
  }),
);

const getLabelFromValue = (value: T): string => {
  const { labelKey } = props;
  if (typeof labelKey === 'function') return labelKey(value);
  return String(value[labelKey as keyof T]);
};

const getValueFromItem = (item: T): string | number => {
  const { valueKey } = props;
  if (typeof valueKey === 'function') return valueKey(item);
  return item[valueKey as keyof T] as string | number;
};
const getKeyFromItem = (item: T): string => String(getValueFromItem(item));

const selectedKey = computed({
  get: () => (selectedValue.value ? getKeyFromItem(selectedValue.value) : ''),
  set: (key: string) => {
    const newValue = props.values.find((item) => getKeyFromItem(item) === key) ?? null;
    searchQuery.value = '';
    emit('update:modelValue', newValue);
  },
});

// Look up the option from `values` by key instead of trusting `modelValue`,
// so labels stay fresh when the options array re-derives (i18n chunks load,
// async data resolves, locale switches). Falls back to `modelValue` if no
// match — preserves behavior for callers whose selection isn't in `values`.
const displayItem = computed<T | null>(() => {
  if (!selectedValue.value) return null;
  const key = getKeyFromItem(selectedValue.value);
  return props.values.find((item) => getKeyFromItem(item) === key) ?? selectedValue.value;
});

function handleClear(event: Event) {
  event.stopPropagation();
  emit('update:modelValue', null);
}

watch(
  searchQuery,
  debounce((query: string) => {
    const lowerCaseQuery = query.toLowerCase();
    isFiltered.value = Boolean(query);
    // Matches the visible label plus any extra searchKeys fields, so labels with
    // computed parts (translations, suffixes) stay searchable alongside raw fields.
    debouncedFilteredValues.value = props.values.filter((item) => {
      if (getLabelFromValue(item).toLowerCase().includes(lowerCaseQuery)) return true;
      return Boolean(props.searchKeys?.some((key) => String(item[key]).toLowerCase().includes(lowerCaseQuery)));
    });
  }, 300),
);

// Sync filtered values when props.values changes (e.g., async-loaded data)
watch(
  () => props.values,
  (newValues) => {
    if (!searchQuery.value) {
      debouncedFilteredValues.value = newValues;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div>
    <template v-if="label">
      <!-- A `label` would forward clicks anywhere on it to the first button slotted
           into label-right; the select itself sits outside FieldLabel either way. -->
      <FieldLabel :label="label" :only-template="Boolean($slots['label-right'])">
        <template v-if="required" #label-after>
          <span class="text-destructive-text" aria-hidden="true">*</span>
        </template>
        <template v-if="$slots['label-right']" #label-right>
          <slot name="label-right" />
        </template>
      </FieldLabel>
    </template>

    <!-- SelectRoot renders no DOM element, so with `field-right` content the trigger button
         and the addon become direct flex children and share one joined outline. -->
    <div :class="cn($slots['field-right'] && 'flex items-stretch')">
      <Select.Select v-model="selectedKey" :open="isOpen" :disabled="disabled" @update:open="onOpenChange">
        <Select.SelectTrigger
          :class="cn('w-full', $slots['field-right'] && 'min-w-0 flex-1 rounded-r-none border-r-0')"
          :aria-required="required || undefined"
        >
          <Select.SelectValue class="min-w-0 flex-1" :placeholder="placeholder ?? t('fields.select.selectOption')">
            <template v-if="displayItem">
              <slot name="trigger" :item="displayItem" :label="getLabelFromValue(displayItem)">
                {{ getLabelFromValue(displayItem) }}
              </slot>
            </template>
            <template v-else>{{ placeholder ?? t('fields.select.selectOption') }}</template>
          </Select.SelectValue>
          <!-- ml-auto is dead here: the flex-1 SelectValue absorbs the slack, so ml-1 provides the real gap. -->
          <button
            v-if="clearable && displayItem"
            type="button"
            :aria-label="t('common.components.selectField.clearSelection')"
            class="text-muted-foreground hover:text-foreground focus-visible:ring-ring mr-1 ml-1 shrink-0 rounded focus:outline-none focus-visible:ring-1"
            @click="handleClear"
            @keydown.enter.stop="handleClear"
            @keydown.space.stop="handleClear"
          >
            <XIcon class="size-3.5" />
          </button>
        </Select.SelectTrigger>

        <Select.SelectContent>
          <template v-if="hasOpened && (withSearch || !!searchKeys)" #header>
            <div class="border-border border-b p-2">
              <input-field
                v-model="searchQuery"
                type="text"
                :placeholder="t('fields.select.searchPlaceholder')"
                trailing-icon-css-class="px-0"
                @keydown.stop
              >
                <template #iconTrailing>
                  <template v-if="searchQuery">
                    <Button variant="ghost" size="icon" @click="searchQuery = ''">
                      <XIcon class="size-4" />
                    </Button>
                  </template>
                </template>
              </input-field>
            </div>
          </template>

          <template v-for="(section, index) in sections" :key="section.label ?? ''">
            <Select.SelectSeparator v-if="index > 0" />
            <component :is="section.label ? Select.SelectGroup : 'div'" :class="section.label ? 'p-0' : 'contents'">
              <Select.SelectLabel v-if="section.label" class="text-muted-foreground text-xs">
                {{ section.label }}
              </Select.SelectLabel>
              <Select.SelectItem
                v-for="item in section.items"
                :key="getKeyFromItem(item)"
                :value="getKeyFromItem(item)"
                :disabled="optionDisabled ? optionDisabled(item) : undefined"
              >
                <slot name="item" :item="item" :label="getLabelFromValue(item)">
                  {{ getLabelFromValue(item) }}
                </slot>
              </Select.SelectItem>
            </component>
          </template>

          <template v-if="$slots['select-bottom-content']" #footer>
            <div class="border-border bg-popover border-t p-1">
              <slot name="select-bottom-content" />
            </div>
          </template>
        </Select.SelectContent>
      </Select.Select>

      <slot name="field-right" />
    </div>

    <FieldError :error-message="errorMessage" />
  </div>
</template>

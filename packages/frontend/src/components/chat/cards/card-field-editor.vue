<script setup lang="ts">
import type { FormattedCategory } from '@/common/types';
import AccountSelectField from '@/components/fields/account-select-field.vue';
import CategorySelectField from '@/components/fields/category-select-field.vue';
import DateField from '@/components/fields/date-field.vue';
import FormattedAmountField from '@/components/fields/formatted-amount-field.vue';
import InputField from '@/components/fields/input-field.vue';
import PayeeSelectField from '@/components/fields/payee-select-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import TagSelectField from '@/components/fields/tag-select-field.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { getCurrencyDecimals } from '@/js/helpers/currency-decimals';
import type { ChatCardDependency, ChatCardField } from '@bt/shared/types';
import { format, isValid, parseISO } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useChatText } from '../chat-text';
import CardField from './card-field.vue';
import { isProposalRef } from './card-values';
import type { CardLookups } from './use-card-lookups';

const props = defineProps<{
  field: ChatCardField;
  modelValue: unknown;
  lookups: CardLookups;
  /** The currency an amount argument is written in; `null` when the card does not say. */
  currencyCode: string | null;
  /** The cards this one depends on, to name a `$proposal:` ref in a value that is shown and not edited. */
  dependsOn: ChatCardDependency[];
}>();

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>();

const { t } = useI18n();
const { keyText, enumValueText } = useChatText();

const DATE_PATTERN = 'yyyy-MM-dd';

type EditorKind =
  | 'text'
  | 'number'
  | 'money'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'boolean'
  | 'account'
  | 'category'
  | 'payee'
  | 'tags'
  | 'currency'
  | 'readonly';

const holdsRef = (value: unknown) =>
  Array.isArray(value) ? value.some((item) => isProposalRef({ value: item })) : isProposalRef({ value });

/**
 * The editor for a field. A value that points to a card not applied yet, or an entity the app has no
 * picker for, is shown and not edited: replacing it would lose the link or invent an id.
 */
const editorKind = computed<EditorKind>(() => {
  const editable = props.field.editable;
  if (!editable || holdsRef(props.modelValue)) return 'readonly';

  if (editable.type !== 'entity') return editable.type;

  const isList = Array.isArray(props.modelValue);
  switch (editable.entity) {
    case 'account':
      return isList ? 'readonly' : 'account';
    case 'category':
      return isList ? 'readonly' : 'category';
    case 'payee':
      return isList ? 'readonly' : 'payee';
    case 'tag':
      return isList ? 'tags' : 'readonly';
    case 'userCurrency':
      return isList ? 'readonly' : 'currency';
    default:
      return 'readonly';
  }
});

const label = computed(() => keyText({ key: props.field.labelKey }) ?? props.field.path);
const amountLabel = computed(() => (props.currencyCode ? `${label.value} (${props.currencyCode})` : label.value));
const amountDecimals = computed(() => getCurrencyDecimals({ code: props.currencyCode }));
const set = (value: unknown) => emit('update:modelValue', value);

const placeholder = computed(() => {
  const kind = editorKind.value;
  const key = kind === 'tags' ? 'tag' : kind;
  return t(`chat.cards.edit.placeholders.${key === 'readonly' ? 'text' : key}`);
});

const text = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''));
const numberValue = computed(() => (typeof props.modelValue === 'number' ? props.modelValue : null));

const dateValue = computed(() => {
  if (typeof props.modelValue !== 'string') return undefined;
  const parsed = parseISO(props.modelValue);
  return isValid(parsed) ? parsed : undefined;
});

const enumValues = computed(() =>
  (props.field.editable?.options ?? []).map((option) => ({
    value: option,
    label: enumValueText({ path: props.field.path, value: option }),
  })),
);
const selectedEnum = computed(() => enumValues.value.find((item) => item.value === String(props.modelValue)) ?? null);
// The options are strings; an argument that is a number goes back as one.
const setEnum = (item: { value: string } | null) =>
  set(typeof props.modelValue === 'number' && item ? Number(item.value) : (item?.value ?? null));

const currencyValues = computed(() => props.lookups.currencyCodes().map((code) => ({ value: code, label: code })));
const selectedCurrency = computed(() => currencyValues.value.find((item) => item.value === props.modelValue) ?? null);

const selectedAccount = computed(
  () => props.lookups.accounts().find((account) => account.id === props.modelValue) ?? null,
);

const findCategory = ({ list, id }: { list: FormattedCategory[]; id: unknown }): FormattedCategory | null => {
  for (const category of list) {
    if (category.id === id) return category;
    const nested = findCategory({ list: category.subCategories ?? [], id });
    if (nested) return nested;
  }
  return null;
};
const selectedCategory = computed(() => findCategory({ list: props.lookups.categories(), id: props.modelValue }));

const tagIds = computed(() => (Array.isArray(props.modelValue) ? props.modelValue.map(String) : []));
</script>

<template>
  <div>
    <InputField
      v-if="editorKind === 'text'"
      :model-value="text"
      :label="label"
      :placeholder="placeholder"
      @update:model-value="set($event)"
    />
    <InputField
      v-else-if="editorKind === 'number'"
      type="number"
      :model-value="numberValue"
      :label="label"
      :placeholder="placeholder"
      @update:model-value="set($event)"
    />
    <FormattedAmountField
      v-else-if="editorKind === 'money'"
      :model-value="numberValue"
      :decimals="amountDecimals"
      :label="amountLabel"
      :placeholder="placeholder"
      @update:model-value="set($event)"
    />
    <DateField
      v-else-if="editorKind === 'date'"
      mode="date"
      :model-value="dateValue"
      :label="label"
      @update:model-value="set(format($event, DATE_PATTERN))"
    />
    <DateField
      v-else-if="editorKind === 'datetime'"
      mode="dateTime"
      :model-value="dateValue"
      :label="label"
      @update:model-value="set($event.toISOString())"
    />
    <SelectField
      v-else-if="editorKind === 'enum'"
      :model-value="selectedEnum"
      :values="enumValues"
      :label="label"
      :placeholder="placeholder"
      @update:model-value="setEnum($event)"
    />
    <label v-else-if="editorKind === 'boolean'" class="flex items-center gap-2 text-sm">
      <Checkbox :model-value="props.modelValue === true" @update:model-value="set(!!$event)" />
      <span>{{ label }}</span>
    </label>
    <AccountSelectField
      v-else-if="editorKind === 'account'"
      :model-value="selectedAccount"
      :accounts="lookups.accounts()"
      :label="label"
      :placeholder="placeholder"
      @update:model-value="set($event?.id ?? null)"
    />
    <CategorySelectField
      v-else-if="editorKind === 'category'"
      :model-value="selectedCategory"
      :values="lookups.categories()"
      :label="label"
      :placeholder="placeholder"
      @update:model-value="set($event?.id ?? null)"
    />
    <PayeeSelectField
      v-else-if="editorKind === 'payee'"
      :model-value="typeof modelValue === 'string' ? modelValue : null"
      :label="label"
      :placeholder="placeholder"
      @update:model-value="set($event)"
    />
    <TagSelectField
      v-else-if="editorKind === 'tags'"
      :model-value="tagIds"
      :label="label"
      :placeholder="placeholder"
      @update:model-value="set($event)"
    />
    <SelectField
      v-else-if="editorKind === 'currency'"
      :model-value="selectedCurrency"
      :values="currencyValues"
      :label="label"
      :placeholder="placeholder"
      with-search
      @update:model-value="set($event?.value ?? null)"
    />
    <!-- A value that is shown and not edited reads as it does on the card: names, dates and labels, never ids. -->
    <dl v-else data-testid="field-readonly">
      <CardField :field="field" :lookups="lookups" :currency-code="currencyCode" :depends-on="dependsOn" disabled />
    </dl>
  </div>
</template>

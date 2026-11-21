<script setup lang="ts">
import AccountMultiSelectField from '@/components/fields/account-multi-select-field.vue';
import InputField from '@/components/fields/input-field.vue';
import PayeeMultiSelectField from '@/components/fields/payee-multi-select-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import { Button } from '@/components/lib/ui/button';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useCurrenciesStore } from '@/stores';
import {
  AUTOMATION_LIMITS,
  type AutomationAmountCurrency,
  type AutomationAmountOperator,
  type AutomationCondition,
  type AutomationConditionField,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { Trash2Icon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import AccountGroupSelect from './account-group-select.vue';
import { migrateAmountBounds } from './automation-validation';
import BankConnectionSelect from './bank-connection-select.vue';
import { CONDITION_FIELDS, CONDITION_REGISTRY } from './condition-registry';
import KeywordChipsField from './keyword-chips-field.vue';
import FieldError from '@/components/fields/components/field-error.vue';

type AmountCondition = Extract<AutomationCondition, { field: 'amount' }>;

const props = defineProps<{
  modelValue: AutomationCondition;
  errorMessage?: string | null;
  /** Fields already used by a sibling row that may appear only once per rule. */
  disabledFields?: AutomationConditionField[];
}>();
const emit = defineEmits<{
  'update:modelValue': [value: AutomationCondition];
  'update:field': [value: AutomationConditionField];
  remove: [];
}>();

const { t } = useI18n();
const { currencies, baseCurrency } = storeToRefs(useCurrenciesStore());

const fieldOptions = computed(() =>
  CONDITION_FIELDS.map((field) => ({ value: field, label: t(`automations.fields.${field}`) })),
);
const operatorOptions = computed(() =>
  CONDITION_REGISTRY[props.modelValue.field].operators.map((operator) => ({
    value: operator,
    label: t(`automations.operators.${operator}`),
  })),
);
const selectedField = computed(() => fieldOptions.value.find((option) => option.value === props.modelValue.field));
const selectedOperator = computed(() =>
  operatorOptions.value.find((option) => option.value === props.modelValue.operator),
);

const typeTabs = computed(() => [
  { value: TRANSACTION_TYPES.income, label: t('automations.summary.transactionTypeValue.income') },
  { value: TRANSACTION_TYPES.expense, label: t('automations.summary.transactionTypeValue.expense') },
]);

const currencyOptions = computed(() => [
  { value: 'transaction', label: t('automations.editor.currency.transaction') },
  { value: 'base', label: t('automations.editor.currency.base', { code: baseCurrency.value?.currencyCode ?? '' }) },
  ...currencies.value.map((item) => ({
    value: item.currencyCode,
    label: t('automations.editor.currency.specific', { code: item.currencyCode }),
  })),
]);

const patch = (condition: AutomationCondition) => emit('update:modelValue', condition);

const changeOperator = ({ operator }: { operator: string }) => {
  const condition = props.modelValue;
  if (condition.field === 'amount') {
    const amountOperator = operator as AutomationAmountOperator;
    patch({
      ...condition,
      operator: amountOperator,
      value: migrateAmountBounds({ condition, operator: amountOperator }),
    });
    return;
  }
  if ((condition.field === 'note' || condition.field === 'merchant') && operator === 'is_empty') {
    patch({ ...condition, operator, value: [] });
    return;
  }
  patch({ ...condition, operator } as AutomationCondition);
};

const isFieldDisabled = (field: AutomationConditionField) =>
  field !== props.modelValue.field && (props.disabledFields?.includes(field) ?? false);

const setAmountBound = ({
  condition,
  key,
  value,
}: {
  condition: AmountCondition;
  key: 'min' | 'max';
  value: string | number | null;
}) =>
  patch({
    ...condition,
    value: {
      ...condition.value,
      [key]: value === null || value === '' || Number.isNaN(Number(value)) ? undefined : Number(value),
    },
  });

const currencyValue = ({ condition }: { condition: AmountCondition }) =>
  condition.currency.mode === 'specific' ? condition.currency.code : condition.currency.mode;

const setCurrency = ({ condition, code }: { condition: AmountCondition; code: string }) => {
  const currency: AutomationAmountCurrency =
    code === 'transaction' || code === 'base' ? { mode: code } : { mode: 'specific', code };
  patch({ ...condition, currency });
};

const setDay = ({ key, value }: { key: 'min' | 'max'; value: string | number | null }) => {
  const condition = props.modelValue as Extract<AutomationCondition, { field: 'dayOfMonth' }>;
  patch({ ...condition, value: { ...condition.value, [key]: Number(value ?? 0) } });
};
</script>

<template>
  <div class="@container/condition p-3">
    <div class="flex flex-wrap items-start gap-2 @xl/condition:flex-nowrap">
      <div class="flex min-w-0 flex-1 gap-2 @xl/condition:flex-none">
        <SelectField
          :model-value="selectedField ?? null"
          :values="fieldOptions"
          :option-disabled="(option) => isFieldDisabled(option.value)"
          class="min-w-0 flex-1 @xl/condition:w-37.5 @xl/condition:flex-none"
          :placeholder="$t('automations.editor.fieldPlaceholder')"
          @update:model-value="(option) => option && emit('update:field', option.value)"
        />
        <SelectField
          :model-value="selectedOperator ?? null"
          :values="operatorOptions"
          class="min-w-0 flex-1 @xl/condition:w-37.5 @xl/condition:flex-none"
          :placeholder="$t('automations.editor.operatorPlaceholder')"
          @update:model-value="(option) => option && changeOperator({ operator: option.value })"
        />
      </div>

      <div class="order-last w-full min-w-0 @xl/condition:order-0 @xl/condition:max-w-xl @xl/condition:flex-1">
        <template v-if="modelValue.field === 'note' || modelValue.field === 'merchant'">
          <KeywordChipsField
            v-if="modelValue.operator !== 'is_empty'"
            :model-value="modelValue.value"
            :max="AUTOMATION_LIMITS.maxKeywords"
            :max-length="AUTOMATION_LIMITS.maxKeywordLength"
            :placeholder="$t('automations.editor.keywordPlaceholder')"
            @update:model-value="(value) => patch({ ...modelValue, value } as AutomationCondition)"
          />
        </template>

        <PayeeMultiSelectField
          v-else-if="modelValue.field === 'payee'"
          :payee-ids="modelValue.value"
          @update:payee-ids="(value) => patch({ ...modelValue, value } as AutomationCondition)"
        />

        <div v-else-if="modelValue.field === 'amount'" class="flex flex-wrap items-start gap-2">
          <InputField
            v-if="modelValue.operator !== 'lte'"
            :model-value="modelValue.value.min ?? null"
            type="number"
            only-positive
            class="w-32"
            :placeholder="
              modelValue.operator === 'between'
                ? $t('automations.editor.minPlaceholder')
                : $t('automations.editor.amountPlaceholder')
            "
            @update:model-value="
              (value) => setAmountBound({ condition: modelValue as AmountCondition, key: 'min', value })
            "
          />
          <InputField
            v-if="modelValue.operator === 'lte' || modelValue.operator === 'between'"
            :model-value="modelValue.value.max ?? null"
            type="number"
            only-positive
            class="w-32"
            :placeholder="
              modelValue.operator === 'between'
                ? $t('automations.editor.maxPlaceholder')
                : $t('automations.editor.amountPlaceholder')
            "
            @update:model-value="
              (value) => setAmountBound({ condition: modelValue as AmountCondition, key: 'max', value })
            "
          />
          <SelectField
            :model-value="
              currencyOptions.find(
                (option) => option.value === currencyValue({ condition: modelValue as AmountCondition }),
              ) ?? null
            "
            :values="currencyOptions"
            with-search
            :search-keys="['label']"
            class="w-56"
            :placeholder="$t('automations.editor.currencyPlaceholder')"
            @update:model-value="
              (option) => option && setCurrency({ condition: modelValue as AmountCondition, code: option.value })
            "
          />
        </div>

        <PillTabs
          v-else-if="modelValue.field === 'transactionType'"
          :items="typeTabs"
          :model-value="modelValue.value"
          @update:model-value="(value) => patch({ ...modelValue, value } as AutomationCondition)"
        />

        <AccountMultiSelectField
          v-else-if="modelValue.field === 'account'"
          include-archived
          :model-value="modelValue.value"
          :placeholder="$t('automations.editor.accountsPlaceholder')"
          @update:model-value="(value) => patch({ ...modelValue, value } as AutomationCondition)"
        />

        <AccountGroupSelect
          v-else-if="modelValue.field === 'accountGroup'"
          :model-value="modelValue.value"
          :placeholder="$t('automations.editor.accountGroupPlaceholder')"
          @update:model-value="(value) => patch({ ...modelValue, value } as AutomationCondition)"
        />

        <BankConnectionSelect
          v-else-if="modelValue.field === 'bankConnection'"
          :model-value="modelValue.value"
          :placeholder="$t('automations.editor.bankConnectionPlaceholder')"
          @update:model-value="(value) => patch({ ...modelValue, value } as AutomationCondition)"
        />

        <div v-else-if="modelValue.field === 'dayOfMonth'" class="flex items-start gap-2">
          <InputField
            :model-value="modelValue.value.min"
            type="number"
            only-positive
            min="1"
            max="31"
            class="w-24"
            :placeholder="$t('automations.editor.dayFromPlaceholder')"
            @update:model-value="(value) => setDay({ key: 'min', value })"
          />
          <InputField
            :model-value="modelValue.value.max"
            type="number"
            only-positive
            min="1"
            max="31"
            class="w-24"
            :placeholder="$t('automations.editor.dayToPlaceholder')"
            @update:model-value="(value) => setDay({ key: 'max', value })"
          />
        </div>
      </div>

      <DesktopOnlyTooltip :content="$t('automations.editor.removeCondition')">
        <Button
          type="button"
          variant="soft-destructive"
          size="icon"
          class="ml-auto shrink-0"
          :aria-label="$t('automations.editor.removeCondition')"
          @click="emit('remove')"
        >
          <Trash2Icon class="size-3.5" />
        </Button>
      </DesktopOnlyTooltip>
    </div>

    <FieldError :error-message="errorMessage" class="mt-2" />
  </div>
</template>

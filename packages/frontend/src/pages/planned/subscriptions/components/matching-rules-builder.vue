<script setup lang="ts">
import AccountSelectField from '@/components/fields/account-select-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { usePrioritizedCurrencies } from '@/composable/data-queries/prioritized-currencies';
import { useCurrencyName } from '@/composable/formatters';
import { useAccountsStore } from '@/stores';
import type { AccountModel, CurrencyModel, SubscriptionMatchingRule } from '@bt/shared/types';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { PlusIcon, Trash2Icon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  modelValue: SubscriptionMatchingRule[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: SubscriptionMatchingRule[]];
}>();

const accountsStore = useAccountsStore();
const { currencies } = usePrioritizedCurrencies();
const { formatCurrencyLabel } = useCurrencyName();

const getSelectedCurrency = ({ rule }: { rule: SubscriptionMatchingRule }) => {
  if (!rule.currencyCode) return null;
  return currencies.value.find((c) => c.code === rule.currencyCode) ?? null;
};

const FIELD_OPTIONS = computed(() => [
  { label: t('planned.subscriptions.rules.fieldOptions.note'), value: 'note' },
  { label: t('planned.subscriptions.rules.fieldOptions.amount'), value: 'amount' },
  { label: t('planned.subscriptions.rules.fieldOptions.transactionType'), value: 'transactionType' },
  { label: t('planned.subscriptions.rules.fieldOptions.account'), value: 'accountId' },
]);

const TRANSACTION_TYPE_OPTIONS = computed(() => [
  { label: t('planned.subscriptions.rules.transactionTypeOptions.income'), value: TRANSACTION_TYPES.income },
  { label: t('planned.subscriptions.rules.transactionTypeOptions.expense'), value: TRANSACTION_TYPES.expense },
]);

const allAccounts = computed(() => accountsStore.accounts ?? []);

const getSelectedAccount = ({ rule }: { rule: SubscriptionMatchingRule }) =>
  accountsStore.accountsRecord[String(rule.value)] ?? null;

const getOperatorForField = (field: string): string => {
  switch (field) {
    case 'note':
      return 'contains_any';
    case 'amount':
      return 'between';
    default:
      return 'equals';
  }
};

const getDefaultValueForField = (field: string): SubscriptionMatchingRule['value'] => {
  switch (field) {
    case 'note':
      return [''];
    case 'amount':
      return { min: 0, max: 0 };
    case 'transactionType':
      return TRANSACTION_TYPES.expense;
    case 'accountId':
      return 0;
    default:
      return '';
  }
};

const addRule = () => {
  const newRules = [
    ...props.modelValue,
    {
      field: 'note' as const,
      operator: 'contains_any' as const,
      value: [''] as string[],
    },
  ];
  emit('update:modelValue', newRules);
};

const removeRule = ({ index }: { index: number }) => {
  const newRules = props.modelValue.filter((_, i) => i !== index);
  emit('update:modelValue', newRules);
};

const updateRuleField = ({ index, field }: { index: number; field: string }) => {
  const newRules = [...props.modelValue];
  newRules[index] = {
    ...newRules[index]!,
    field: field as SubscriptionMatchingRule['field'],
    operator: getOperatorForField(field) as SubscriptionMatchingRule['operator'],
    value: getDefaultValueForField(field),
  };
  emit('update:modelValue', newRules);
};

const updateRuleValue = ({ index, value }: { index: number; value: SubscriptionMatchingRule['value'] }) => {
  const newRules = [...props.modelValue];
  newRules[index] = { ...newRules[index]!, value };
  emit('update:modelValue', newRules);
};

const updateRuleCurrencyCode = ({ index, currencyCode }: { index: number; currencyCode: string }) => {
  const newRules = [...props.modelValue];
  newRules[index] = { ...newRules[index]!, currencyCode: currencyCode || undefined };
  emit('update:modelValue', newRules);
};

const updateNoteKeyword = ({
  ruleIndex,
  keywordIndex,
  value,
}: {
  ruleIndex: number;
  keywordIndex: number;
  value: string;
}) => {
  const rule = props.modelValue[ruleIndex]!;
  const keywords = [...(rule.value as string[])];
  keywords[keywordIndex] = value;
  updateRuleValue({ index: ruleIndex, value: keywords });
};

const addNoteKeyword = ({ ruleIndex }: { ruleIndex: number }) => {
  const rule = props.modelValue[ruleIndex]!;
  const keywords = [...(rule.value as string[]), ''];
  updateRuleValue({ index: ruleIndex, value: keywords });
};

const removeNoteKeyword = ({ ruleIndex, keywordIndex }: { ruleIndex: number; keywordIndex: number }) => {
  const rule = props.modelValue[ruleIndex]!;
  const keywords = (rule.value as string[]).filter((_, i) => i !== keywordIndex);
  if (keywords.length === 0) keywords.push('');
  updateRuleValue({ index: ruleIndex, value: keywords });
};

const getAmountValue = ({ rule }: { rule: SubscriptionMatchingRule }): { min: number; max: number } => {
  return rule.value as { min: number; max: number };
};

const updateAmountMin = ({ index, rule, v }: { index: number; rule: SubscriptionMatchingRule; v: unknown }) => {
  const current = getAmountValue({ rule });
  updateRuleValue({ index, value: { ...current, min: Number(v ?? 0) } });
};

const updateAmountMax = ({ index, rule, v }: { index: number; rule: SubscriptionMatchingRule; v: unknown }) => {
  const current = getAmountValue({ rule });
  updateRuleValue({ index, value: { ...current, max: Number(v ?? 0) } });
};
</script>

<template>
  <div class="grid gap-2">
    <div v-for="(rule, index) in modelValue" :key="index" class="border-border grid gap-2 rounded-lg border p-2.5">
      <div class="flex items-start gap-2">
        <SelectField
          :model-value="FIELD_OPTIONS.find((o) => o.value === rule.field) ?? null"
          :values="FIELD_OPTIONS"
          label-key="label"
          value-key="value"
          class="min-w-0 flex-1"
          :placeholder="$t('planned.subscriptions.rules.selectField')"
          @update:model-value="(v: any) => v && updateRuleField({ index, field: v.value })"
        />
        <DesktopOnlyTooltip :content="$t('planned.subscriptions.editors.automation.removeRule')">
          <Button type="button" variant="ghost-destructive" size="icon" @click="removeRule({ index })">
            <Trash2Icon class="size-3.5" />
          </Button>
        </DesktopOnlyTooltip>
      </div>

      <template v-if="rule.field === 'note'">
        <div class="grid gap-1.5">
          <div v-for="(keyword, ki) in rule.value as string[]" :key="ki" class="flex items-center gap-2">
            <InputField
              :model-value="keyword"
              :placeholder="$t('planned.subscriptions.rules.keywordPlaceholder')"
              class="min-w-0 flex-1"
              @update:model-value="
                (v: any) => updateNoteKeyword({ ruleIndex: index, keywordIndex: ki, value: String(v ?? '') })
              "
            />
            <DesktopOnlyTooltip
              v-if="(rule.value as string[]).length > 1"
              :content="$t('planned.subscriptions.editors.automation.removeKeyword')"
            >
              <Button
                type="button"
                variant="ghost-destructive"
                size="icon"
                class="shrink-0"
                @click="removeNoteKeyword({ ruleIndex: index, keywordIndex: ki })"
              >
                <Trash2Icon class="size-3.5" />
              </Button>
            </DesktopOnlyTooltip>
          </div>
          <div class="flex items-center justify-between gap-2">
            <p class="text-muted-foreground min-w-0 text-xs">
              {{ $t('planned.subscriptions.rules.noteDescription') }}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="shrink-0"
              @click="addNoteKeyword({ ruleIndex: index })"
            >
              <PlusIcon class="size-3.5" />
              {{ $t('planned.subscriptions.rules.addKeyword') }}
            </Button>
          </div>
        </div>
      </template>

      <template v-else-if="rule.field === 'amount'">
        <div class="grid grid-cols-2 gap-2">
          <InputField
            :model-value="getAmountValue({ rule }).min"
            type="number"
            :label="$t('planned.subscriptions.rules.minAmount')"
            :placeholder="$t('planned.subscriptions.form.amountPlaceholder')"
            only-positive
            @update:model-value="(v: any) => updateAmountMin({ index, rule, v })"
          />
          <InputField
            :model-value="getAmountValue({ rule }).max"
            type="number"
            :label="$t('planned.subscriptions.rules.maxAmount')"
            :placeholder="$t('planned.subscriptions.form.amountPlaceholder')"
            only-positive
            @update:model-value="(v: any) => updateAmountMax({ index, rule, v })"
          />
        </div>
        <SelectField
          :model-value="getSelectedCurrency({ rule })"
          :values="currencies"
          value-key="code"
          :label="$t('planned.subscriptions.rules.currencyCode')"
          :placeholder="$t('planned.subscriptions.editors.basics.currencyPlaceholder')"
          with-search
          :label-key="(item: CurrencyModel) => formatCurrencyLabel({ code: item.code, fallbackName: item.currency })"
          @update:model-value="(v: any) => updateRuleCurrencyCode({ index, currencyCode: v?.code ?? '' })"
        />
      </template>

      <template v-else-if="rule.field === 'transactionType'">
        <SelectField
          :model-value="TRANSACTION_TYPE_OPTIONS.find((o) => o.value === rule.value) ?? null"
          :values="TRANSACTION_TYPE_OPTIONS"
          label-key="label"
          value-key="value"
          :label="$t('planned.subscriptions.rules.fieldOptions.transactionType')"
          :placeholder="$t('planned.subscriptions.editors.automation.selectTransactionType')"
          @update:model-value="(v: any) => v && updateRuleValue({ index, value: v.value })"
        />
      </template>

      <template v-else-if="rule.field === 'accountId'">
        <AccountSelectField
          :model-value="getSelectedAccount({ rule })"
          :accounts="allAccounts"
          :label="$t('planned.subscriptions.rules.fieldOptions.account')"
          :placeholder="$t('planned.subscriptions.editors.automation.accountPlaceholder')"
          @update:model-value="
            (account: AccountModel | null) => account && updateRuleValue({ index, value: account.id })
          "
        />
      </template>
    </div>

    <Button type="button" variant="outline" size="sm" class="justify-self-start" @click="addRule">
      <PlusIcon class="size-4" />
      {{ $t('planned.subscriptions.rules.addRule') }}
    </Button>
  </div>
</template>

<template>
  <SelectField
    ref="selectFieldRef"
    :model-value="selected"
    :values="visibleAccounts"
    :label-key="getLabel"
    value-key="id"
    :with-search="withSearch"
    :search-keys="withSearch ? SEARCH_KEYS : undefined"
    :label="label"
    :placeholder="placeholder"
    :error-message="errorMessage"
    :disabled="disabled"
    :clearable="clearable"
    :required="required"
    :option-disabled="optionDisabled"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #trigger="{ item, label: rowLabel }">
      <span class="flex w-full min-w-0 items-center gap-2">
        <AccountOptionRow :account="item" :label="rowLabel" variant="trigger" />
        <StarIcon
          v-if="!item._isOutOfWallet && item.id === defaultAccountId"
          class="text-primary-text size-3.5 shrink-0 fill-current"
        />
        <span v-if="!item._isOutOfWallet" :class="CURRENCY_CHIP_CLASSES">{{ item.currencyCode }}</span>
      </span>
    </template>

    <template #item="{ item, label: rowLabel }">
      <span class="flex w-full min-w-0 items-center gap-2">
        <AccountOptionRow :account="item" :label="rowLabel" />
        <StarIcon
          v-if="!item._isOutOfWallet && item.id === defaultAccountId"
          class="text-primary-text size-3.5 shrink-0 fill-current"
        />
        <span v-if="!item._isOutOfWallet" :class="CURRENCY_CHIP_CLASSES">{{ item.currencyCode }}</span>
      </span>
    </template>

    <template v-if="$slots['label-right']" #label-right>
      <slot name="label-right" />
    </template>

    <template v-if="$slots['field-right']" #field-right>
      <slot name="field-right" />
    </template>

    <template v-if="$slots['select-bottom-content']" #select-bottom-content>
      <slot name="select-bottom-content" />
    </template>
  </SelectField>
</template>

<script setup lang="ts">
import AccountOptionRow from '@/components/dialogs/manage-transaction/components/account-option-row.vue';
import SelectField from '@/components/fields/select-field.vue';
import { OUT_OF_WALLET_ACCOUNT_MOCK } from '@/common/const';
import { getAccountDisplayLabel } from '@/common/utils/account-display';
import { filterDropdownAccounts, useAccountDropdownPrefs } from '@/composable/use-account-dropdown-prefs';
import { StarIcon } from '@lucide/vue';
import { AccountModel } from '@bt/shared/types';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

type AccountOption = AccountModel & { _isOutOfWallet?: boolean };

const SEARCH_KEYS: ['name', 'currencyCode'] = ['name', 'currencyCode'];
const CURRENCY_CHIP_CLASSES =
  'border-border text-muted-foreground ml-auto shrink-0 rounded-[5px] border px-1.5 py-px text-[10.5px] font-bold tracking-wider tabular-nums';

const props = withDefaults(
  defineProps<{
    modelValue: AccountModel | null;
    /** Full option universe: no out-of-wallet mock, unfiltered for archived. */
    accounts: AccountModel[];
    includeOutOfWallet?: boolean;
    /** Offer archived accounts regardless of the global dropdown preference. */
    includeArchived?: boolean;
    label?: string;
    placeholder?: string;
    errorMessage?: string;
    disabled?: boolean;
    clearable?: boolean;
    required?: boolean;
    withSearch?: boolean;
    optionDisabled?: (account: AccountModel) => boolean;
  }>(),
  {
    label: undefined,
    placeholder: undefined,
    errorMessage: undefined,
    optionDisabled: undefined,
    withSearch: true,
  },
);

const emit = defineEmits<{
  'update:modelValue': [account: AccountModel | null];
}>();

const { t } = useI18n();
const { showArchivedInDropdowns, defaultAccountId } = useAccountDropdownPrefs();

// The mock's `name` is an i18n key, real accounts keep their "(archived)"/"(shared by @owner)" suffixes.
const getLabel = (account: AccountOption) =>
  account._isOutOfWallet ? t(account.name) : getAccountDisplayLabel(account);

const selectFieldRef = ref<{ open: () => void } | null>(null);
defineExpose({ open: () => selectFieldRef.value?.open() });

// Widen the selection to the option type so select-field's generic resolves to AccountOption.
const selected = computed<AccountOption | null>(() => props.modelValue);

const visibleAccounts = computed<AccountOption[]>(() => {
  const accounts = filterDropdownAccounts({
    accounts: props.accounts,
    showArchived: props.includeArchived || showArchivedInDropdowns.value,
    selectedId: props.modelValue?.id,
  });
  return props.includeOutOfWallet ? [OUT_OF_WALLET_ACCOUNT_MOCK, ...accounts] : accounts;
});
</script>

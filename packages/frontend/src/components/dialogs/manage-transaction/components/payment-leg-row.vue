<script setup lang="ts">
import CurrencyChip from '@/components/common/currency-chip.vue';
import AccountSelectField from '@/components/fields/account-select-field.vue';
import FieldError from '@/components/fields/components/field-error.vue';
import InputField from '@/components/fields/input-field.vue';
import { cn } from '@/lib/utils';
import type { AccountModel } from '@bt/shared/types';
import { ref } from 'vue';

defineProps<{
  account: AccountModel | null;
  accounts: AccountModel[];
  accountPlaceholder: string;
  amount: number | null;
  currencyCode?: string;
  /** Account and amount can't change here: a linked or bank-synced row. */
  locked?: boolean;
  disabled?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  'update:account': [value: AccountModel | null];
  'update:amount': [value: string | number | null];
  'amount-blur': [];
}>();

const amountFieldRef = ref<InstanceType<typeof InputField> | null>(null);

defineExpose({
  focus: () => amountFieldRef.value?.focus(),
  select: () => amountFieldRef.value?.select(),
});
</script>

<template>
  <div class="@container">
    <div
      :class="
        cn(
          'border-input bg-input-background focus-within:border-ring flex h-10 w-full items-stretch overflow-hidden rounded-md border md:h-9',
          errorMessage && 'border-destructive',
        )
      "
    >
      <div class="flex min-w-0 flex-1 items-center overflow-hidden">
        <AccountSelectField
          class="min-w-0 flex-1"
          embedded
          :model-value="account"
          :accounts="accounts"
          :placeholder="accountPlaceholder"
          :disabled="disabled || locked"
          @update:model-value="emit('update:account', $event)"
        />
        <slot name="account-addon" />
      </div>

      <div class="border-input flex w-28 shrink-0 items-center border-l pr-2 @sm:w-32 [&_input]:px-2">
        <InputField
          ref="amountFieldRef"
          class="min-w-0 flex-1 rounded-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
          :model-value="amount"
          type="number"
          only-positive
          :placeholder="$t('dialogs.manageTransaction.form.amountPlaceholder')"
          :aria-label="$t('dialogs.manageTransaction.form.amountLabel')"
          :disabled="disabled || locked"
          @update:model-value="emit('update:amount', $event)"
          @blur="emit('amount-blur')"
        />
        <CurrencyChip v-if="currencyCode" :code="currencyCode" />
      </div>

      <div
        v-if="$slots.converted"
        class="border-input flex w-28 shrink-0 items-center gap-1 border-l pr-1 pl-2 @sm:w-36 [&_input]:px-1"
      >
        <slot name="converted" />
      </div>

      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-0.5 pr-1">
        <slot name="actions" />
      </div>
    </div>

    <FieldError :error-message="errorMessage" />
  </div>
</template>

<script setup lang="ts">
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useNotificationCenter } from '@/components/notification-center';
import { useFormValidation } from '@/composable';
import { useAdjustAccountBalance } from '@/composable/data-queries/accounts';
import { useAccountCurrencyCode } from '@/composable/use-account-currency-code';
import { useAccountDisplayBalance } from '@/composable/use-account-display-balance';
import { toLocalCurrencyNumber } from '@/js/helpers';
import * as validators from '@/js/helpers/validators';
import { captureException } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { ACCOUNT_CATEGORIES, AccountModel } from '@bt/shared/types';
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ account: AccountModel }>();
const emit = defineEmits<{ close: [] }>();

const { mutateAsync: adjustBalance, isPending } = useAdjustAccountBalance();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { hasCreditLimitAdjustment, displayBalance } = useAccountDisplayBalance({
  account: toRef(() => props.account),
});
const { t, te } = useI18n();

const isVehicle = computed(() => props.account.accountCategory === ACCOUNT_CATEGORIES.vehicle);

/**
 * Look up a copy key, preferring the vehicle-override namespace when the
 * underlying account is a vehicle, falling back to the generic
 * balance-adjustment namespace otherwise (or when no vehicle-specific copy
 * exists for that key). `params` is forwarded to `$t` when present.
 */
const label = (key: string, params?: Record<string, string | number>): string => {
  if (isVehicle.value) {
    const vehicleKey = `pages.vehicleDetails.valueOverrideDialog.${key}`;
    if (te(vehicleKey)) return params ? t(vehicleKey, params) : t(vehicleKey);
  }
  const fallbackKey = `pages.account.balanceAdjustmentDialog.${key}`;
  return params ? t(fallbackKey, params) : t(fallbackKey);
};

const isOpen = ref(true);
const mode = ref<'set-to' | 'adjust-by'>('set-to');
const form = ref({ amount: null as number | null, note: '', time: new Date() });
const direction = ref<'income' | 'expense'>('income');

const rules = computed(() => ({
  form: {
    amount: {
      required: validators.required,
      currencyDecimal: validators.currencyDecimal,
      ...(mode.value === 'adjust-by' ? { minValue: validators.minValue(0) } : {}),
    },
    note: {},
  },
}));

const { isFormValid, getFieldErrorMessage, touchField, resetValidation } = useFormValidation(
  { form },
  rules,
  undefined,
  {
    customValidationMessages: {
      currencyDecimal: t('forms.validators.invalidCurrencyDecimal'),
      minValue: t('forms.validators.mustBePositive'),
    },
  },
);

const currencyCode = useAccountCurrencyCode({ account: toRef(() => props.account) });

// Actual target balance for the API (always in real currentBalance terms)
const computedTarget = computed<number | null>(() => {
  if (form.value.amount === null) return null;
  if (mode.value === 'set-to') {
    // User enters in display-balance terms; convert back to actual
    return hasCreditLimitAdjustment.value ? form.value.amount + props.account.creditLimit : form.value.amount;
  }
  const sign = direction.value === 'income' ? 1 : -1;
  return props.account.currentBalance + sign * form.value.amount;
});

// Display target for the preview (what the user sees as the "new balance")
const displayTarget = computed<number | null>(() => {
  if (form.value.amount === null) return null;
  if (mode.value === 'set-to') return form.value.amount;
  return displayBalance.value + (direction.value === 'income' ? 1 : -1) * form.value.amount;
});

const diff = computed<number | null>(() =>
  computedTarget.value !== null ? computedTarget.value - props.account.currentBalance : null,
);

const previewType = computed<'income' | 'expense' | null>(() => {
  if (diff.value === null || diff.value === 0) return null;
  return diff.value > 0 ? 'income' : 'expense';
});

const isValid = computed(() => diff.value !== null && diff.value !== 0);

const submit = async () => {
  if (!isFormValid('form') || !isValid.value || computedTarget.value === null) return;

  try {
    await adjustBalance({
      id: props.account.id,
      targetBalance: computedTarget.value,
      note: form.value.note || undefined,
      time: form.value.time,
    });
    addSuccessNotification(label('successNotification'));
    isOpen.value = false;
  } catch (error) {
    addErrorNotification(label('errorNotification'));
    captureException({ error, context: { source: 'balanceAdjustmentDialog', accountId: props.account.id } });
  }
};

watch(isOpen, (val) => {
  if (!val) emit('close');
});

// Reset form + validation when switching modes
watch(mode, () => {
  form.value.amount = null;
  form.value.note = '';
  form.value.time = new Date();
  resetValidation();
});
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen">
    <template #title>{{ label('title') }}</template>

    <div class="grid gap-4 py-2">
      <!-- Mode toggle — styled tabs -->
      <div class="border-border bg-muted/20 flex gap-1 rounded-lg border p-1">
        <button
          type="button"
          :class="
            cn(
              'flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              mode === 'set-to' ? 'bg-dialog text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )
          "
          @click="mode = 'set-to'"
        >
          {{ label('setToBalance') }}
        </button>
        <button
          type="button"
          :class="
            cn(
              'flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-all',
              mode === 'adjust-by'
                ? 'bg-dialog text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )
          "
          @click="mode = 'adjust-by'"
        >
          {{ label('adjustByAmount') }}
        </button>
      </div>

      <!-- Amount input -->
      <InputField
        v-model="form.amount"
        type="number"
        :label="mode === 'set-to' ? label('newBalance') : label('amount')"
        :placeholder="mode === 'set-to' ? label('enterTargetBalance') : label('enterAmount')"
        :only-positive="mode === 'adjust-by'"
        :error-message="getFieldErrorMessage('form.amount')"
        @blur="touchField('form.amount')"
      >
        <template #iconTrailing>
          <span class="text-muted-foreground text-sm">{{ currencyCode }}</span>
        </template>
      </InputField>

      <!-- Direction toggle — Income/Expense with color coding -->
      <div v-if="mode === 'adjust-by'" class="flex gap-1.5">
        <button
          type="button"
          :class="
            cn(
              'h-9 flex-1 cursor-pointer rounded-md px-3 text-sm font-medium transition-all',
              direction === 'income'
                ? 'bg-green-500/15 text-green-600 ring-1 ring-green-500/30 dark:text-green-400'
                : 'text-muted-foreground hover:bg-green-500/10 hover:text-green-600 dark:hover:text-green-400',
            )
          "
          @click="direction = 'income'"
        >
          {{ label('income') }}
        </button>
        <button
          type="button"
          :class="
            cn(
              'h-9 flex-1 cursor-pointer rounded-md px-3 text-sm font-medium transition-all',
              direction === 'expense'
                ? 'bg-red-500/15 text-red-600 ring-1 ring-red-500/30 dark:text-red-400'
                : 'text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400',
            )
          "
          @click="direction = 'expense'"
        >
          {{ label('expense') }}
        </button>
      </div>

      <!-- Live preview panel — fixed min-height to prevent layout shift -->
      <div class="border-border bg-muted/20 flex min-h-[calc(2lh+2rem)] flex-col justify-center rounded-lg border p-4">
        <template v-if="diff === null">
          <p class="text-muted-foreground text-sm">{{ label('enterAmountAbove') }}</p>
        </template>
        <template v-else-if="diff === 0">
          <p class="text-muted-foreground text-sm">
            {{ label('noAdjustmentNeeded') }}
          </p>
        </template>
        <template v-else>
          <p class="text-muted-foreground mb-1 text-sm">
            {{ toLocalCurrencyNumber(displayBalance, { currency: currencyCode }) }} {{ currencyCode }}
            →
            <span class="text-foreground font-medium"
              >{{ toLocalCurrencyNumber(displayTarget!, { currency: currencyCode }) }} {{ currencyCode }}</span
            >
          </p>
          <p
            class="text-sm font-medium"
            :class="previewType === 'income' ? 'text-app-income-color' : 'text-app-expense-color'"
          >
            {{
              previewType === 'income'
                ? label('incomeWillBeCreated', {
                    amount: toLocalCurrencyNumber(Math.abs(diff), { currency: currencyCode }),
                    currency: currencyCode,
                  })
                : label('expenseWillBeCreated', {
                    amount: toLocalCurrencyNumber(Math.abs(diff), { currency: currencyCode }),
                    currency: currencyCode,
                  })
            }}
          </p>
        </template>
      </div>

      <DateField v-model="form.time" :label="label('effectiveDate')" />

      <InputField v-model="form.note" :label="label('transactionNote')" :placeholder="label('optionalNote')" />
    </div>

    <template #footer="{ close }">
      <Button variant="outline" @click="close">{{ label('cancel') }}</Button>
      <Button :disabled="!isValid || isPending" @click="submit">
        {{ isPending ? label('saving') : label('confirm') }}
      </Button>
    </template>
  </ResponsiveDialog>
</template>

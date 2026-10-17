<script setup lang="ts">
import { type SubscriptionDetail, updateSubscription } from '@/api/subscriptions';
import {
  type LogoSelection,
  logoSelectionKey,
  toLogoPayload,
  toLogoSelection,
} from '@/components/common/logo-selection';
import LogoSquareField from '@/components/common/logo-square-field.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { Callout } from '@/components/lib/ui/callout';
import { useNotificationCenter } from '@/components/notification-center';
import { usePrioritizedCurrencies } from '@/composable/data-queries/prioritized-currencies';
import { useInvalidateSubscriptionQueries, useResetSubscriptionLogo } from '@/composable/data-queries/subscriptions';
import { useFormValidation } from '@/composable/form-validator';
import { useCurrencyName, useFormatCurrency } from '@/composable/formatters';
import { ApiErrorResponseError } from '@/js/errors';
import { getCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { helpers, required } from '@/js/helpers/validators';
import { type CurrencyModel, SUBSCRIPTION_TYPES, TRANSACTION_TYPES } from '@bt/shared/types';
import { useMutation } from '@tanstack/vue-query';
import { format, parseISO } from 'date-fns';
import { ArrowDownIcon, ArrowUpIcon, CreditCardIcon, ReceiptIcon, RepeatIcon } from '@lucide/vue';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ subscription: SubscriptionDetail }>();
const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const { currencies } = usePrioritizedCurrencies();
const { formatCurrencyLabel } = useCurrencyName();
const { formatAmountByCurrencyCode } = useFormatCurrency();
const invalidateSubscriptionQueries = useInvalidateSubscriptionQueries();
const resetLogoMutation = useResetSubscriptionLogo();

interface BasicsForm {
  name: string;
  type: SUBSCRIPTION_TYPES;
  expectedAmount: number | null;
  expectedCurrencyCode: string;
  dueDate: Date | null;
  maxOccurrences: number | null;
  logo: LogoSelection | null;
}

const toSelection = () =>
  toLogoSelection({
    logoDomain: props.subscription.logoDomain,
    logoInitials: props.subscription.logoInitials,
    logoColor: props.subscription.logoColor,
  });

/**
 * Logo snapshot taken when the dialog opens. The payload carries logo keys only
 * when the pick differs from it, so an untouched picker leaves the auto-resolver
 * in charge instead of stamping a manual override.
 */
const initialLogo = ref<LogoSelection | null>(toSelection());

const buildFormState = (): BasicsForm => ({
  name: props.subscription.name,
  type: props.subscription.type,
  expectedAmount: props.subscription.expectedAmount ?? null,
  expectedCurrencyCode: props.subscription.expectedCurrencyCode ?? '',
  // parseISO keeps a date-only string on the same calendar day in every timezone;
  // new Date() would parse it as UTC and shift a day west of UTC, and the backend
  // treats a shifted dueDate as a real reschedule.
  dueDate: props.subscription.dueDate ? parseISO(props.subscription.dueDate) : null,
  maxOccurrences: props.subscription.maxOccurrences ?? null,
  logo: toSelection(),
});

const form = ref<BasicsForm>(buildFormState());
const formError = ref<string | null>(null);

watch(open, (isOpen) => {
  if (!isOpen) return;
  initialLogo.value = toSelection();
  form.value = buildFormState();
  formError.value = null;
});

const isInstallment = computed(() => form.value.type === SUBSCRIPTION_TYPES.installment);

/** The API demands a full schedule alongside a switch to installment, so the two
 *  fields are surfaced inline whenever the stored subscription lacks either. */
const needsInstallmentSchedule = computed(
  () => isInstallment.value && (!props.subscription.dueDate || props.subscription.maxOccurrences == null),
);

const typeOptions = computed(() => [
  {
    value: SUBSCRIPTION_TYPES.subscription,
    label: t('planned.subscriptions.typeSubscription'),
    desc: t('planned.subscriptions.form.typeSubscriptionDesc'),
    icon: RepeatIcon,
  },
  {
    value: SUBSCRIPTION_TYPES.bill,
    label: t('planned.subscriptions.typeBill'),
    desc: t('planned.subscriptions.form.typeBillDesc'),
    icon: ReceiptIcon,
  },
  {
    value: SUBSCRIPTION_TYPES.installment,
    label: t('planned.subscriptions.typeInstallment'),
    desc: t('planned.subscriptions.form.typeInstallmentDesc'),
    icon: CreditCardIcon,
  },
]);

const selectedTypeOption = computed(() => typeOptions.value.find((opt) => opt.value === form.value.type) ?? null);

const selectedCurrency = computed(() => {
  if (!form.value.expectedCurrencyCode) return null;
  return currencies.value.find((c) => c.code === form.value.expectedCurrencyCode) ?? null;
});

const amountDecimals = computed(() => getCurrencyDecimals({ code: form.value.expectedCurrencyCode }));

const isIncome = computed(() => props.subscription.transactionType === TRANSACTION_TYPES.income);

const installmentTotalLabel = computed(() => {
  if (!isInstallment.value) return null;
  const { expectedAmount, maxOccurrences, expectedCurrencyCode } = form.value;
  if (!expectedAmount || !maxOccurrences || !expectedCurrencyCode) return null;
  return formatAmountByCurrencyCode(expectedAmount * maxOccurrences, expectedCurrencyCode);
});

const validationRules = computed(() => ({
  name: { required },
  expectedAmount: {
    requiredForSubscription: helpers.withMessage(
      t('planned.subscriptions.form.validationSubscriptionRequiresAmount'),
      (value: number | null, siblings: BasicsForm) => {
        if (siblings.type !== SUBSCRIPTION_TYPES.subscription) return true;
        return value !== null && value > 0;
      },
    ),
  },
  expectedCurrencyCode: {
    requiredWithAmount: helpers.withMessage(
      t('planned.subscriptions.form.validationAmountCurrency'),
      (value: string, siblings: BasicsForm) => {
        if (siblings.expectedAmount === null || siblings.expectedAmount <= 0) return true;
        return !!value;
      },
    ),
  },
  dueDate: {
    requiredForInstallment: helpers.withMessage(
      t('planned.subscriptions.form.validationInstallmentRequiresSchedule'),
      (value: Date | null, siblings: BasicsForm) => {
        if (siblings.type !== SUBSCRIPTION_TYPES.installment) return true;
        return value != null;
      },
    ),
  },
  maxOccurrences: {
    requiredForInstallment: helpers.withMessage(
      t('planned.subscriptions.form.validationInstallmentRequiresCount'),
      (value: number | null, siblings: BasicsForm) => {
        if (siblings.type !== SUBSCRIPTION_TYPES.installment) return true;
        return value != null && value > 0;
      },
    ),
  },
}));

const { isFormValid, getFieldErrorMessage, touchField } = useFormValidation(
  { form },
  computed(() => ({ form: validationRules.value })),
);

const { mutate, isPending } = useMutation({
  mutationFn: (payload: Parameters<typeof updateSubscription>[0]['payload']) =>
    updateSubscription({ id: props.subscription.id, payload }),
  onSuccess: () => {
    invalidateSubscriptionQueries();
    addSuccessNotification(t('planned.subscriptions.updateSuccess'));
    open.value = false;
  },
  onError: (err) => {
    formError.value =
      err instanceof ApiErrorResponseError
        ? (err.data.message ?? t('planned.subscriptions.updateError'))
        : t('planned.subscriptions.updateError');
  },
});

const toIsoDate = ({ date }: { date: Date }) => format(date, 'yyyy-MM-dd');

const handleSubmit = async () => {
  if (!isFormValid()) return;
  formError.value = null;

  const logoChanged =
    logoSelectionKey({ selection: form.value.logo }) !== logoSelectionKey({ selection: initialLogo.value });
  // Clearing an existing logo means "back to automatic", which only the reset
  // endpoint expresses: null logo keys on an update stamp a manual override and
  // pin the logo off forever. It runs first so a failure aborts the save.
  const isLogoReset = logoChanged && !form.value.logo;

  if (isLogoReset) {
    try {
      await resetLogoMutation.mutateAsync({ id: props.subscription.id });
    } catch {
      formError.value = t('planned.subscriptions.updateError');
      return;
    }
  }

  const storedDueDate = props.subscription.dueDate;

  mutate({
    name: form.value.name,
    type: form.value.type,
    expectedAmount: form.value.expectedAmount || null,
    expectedCurrencyCode: form.value.expectedAmount ? form.value.expectedCurrencyCode || null : null,
    // A payload switching to installment is rejected without a full schedule, so
    // the stored values ride along when the inline fields stay hidden.
    ...(isInstallment.value
      ? {
          dueDate: form.value.dueDate ? toIsoDate({ date: form.value.dueDate }) : storedDueDate,
          maxOccurrences: form.value.maxOccurrences ?? props.subscription.maxOccurrences,
        }
      : {}),
    ...(logoChanged && !isLogoReset ? toLogoPayload({ selection: form.value.logo }) : {}),
  } as Parameters<typeof updateSubscription>[0]['payload']);
};
</script>

<template>
  <ResponsiveDialog v-model:open="open" dialog-content-class="max-w-lg">
    <template #title>{{ $t('planned.subscriptions.editors.basics.title') }}</template>
    <template #description>{{ $t('planned.subscriptions.editors.basics.description') }}</template>

    <form id="edit-subscription-basics" class="grid gap-4" @submit.prevent="handleSubmit">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <InputField
            v-model="form.name"
            :label="$t('planned.subscriptions.form.nameLabel')"
            :placeholder="$t('planned.subscriptions.form.namePlaceholder')"
            :error-message="getFieldErrorMessage('form.name')"
            @blur="touchField('form.name')"
          />
        </div>
        <LogoSquareField
          v-model="form.logo"
          :name-for-search="form.name"
          size-class="size-10 rounded-lg"
          align="with-labeled-field"
        />
      </div>

      <div class="grid gap-2">
        <span class="text-foreground text-sm font-medium">
          {{ $t('planned.subscriptions.form.transactionTypeLabel') }}
        </span>
        <ResponsiveTooltip
          :content="$t('planned.subscriptions.form.transactionTypeLockedTooltip')"
          content-class-name="max-w-72"
        >
          <span
            :class="[
              'inline-flex w-fit items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium',
              isIncome
                ? 'bg-app-income-color/15 text-app-income-color'
                : 'bg-app-expense-color/15 text-app-expense-color',
            ]"
          >
            <component :is="isIncome ? ArrowDownIcon : ArrowUpIcon" class="size-4" />
            {{
              isIncome
                ? $t('planned.subscriptions.form.transactionTypeIncome')
                : $t('planned.subscriptions.form.transactionTypeExpense')
            }}
          </span>
        </ResponsiveTooltip>
      </div>

      <div>
        <SelectField
          :model-value="selectedTypeOption"
          :values="typeOptions"
          label-key="label"
          value-key="value"
          :label="$t('planned.subscriptions.form.typeLabel')"
          :placeholder="$t('planned.subscriptions.editors.basics.kindPlaceholder')"
          @update:model-value="(v: any) => v && (form.type = v.value)"
        >
          <template #item="{ item }">
            <div class="flex items-start gap-2.5 py-0.5">
              <span
                class="border-input bg-muted/40 text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border"
              >
                <component :is="item.icon" class="size-4" />
              </span>
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="text-sm leading-tight font-medium">{{ item.label }}</span>
                <span class="text-muted-foreground text-xs leading-snug">{{ item.desc }}</span>
              </div>
            </div>
          </template>
        </SelectField>
        <p v-if="selectedTypeOption" class="text-muted-foreground mt-1.5 text-xs">{{ selectedTypeOption.desc }}</p>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <InputField
          v-model.number="form.expectedAmount"
          type="number"
          :decimals="amountDecimals"
          :label="$t('planned.subscriptions.form.amountLabel')"
          :placeholder="$t('planned.subscriptions.form.amountPlaceholder')"
          :error-message="getFieldErrorMessage('form.expectedAmount')"
          only-positive
          @blur="touchField('form.expectedAmount')"
        />
        <SelectField
          :model-value="selectedCurrency"
          :values="currencies"
          value-key="code"
          :label="$t('planned.subscriptions.form.currencyLabel')"
          :placeholder="$t('planned.subscriptions.editors.basics.currencyPlaceholder')"
          :error-message="getFieldErrorMessage('form.expectedCurrencyCode')"
          with-search
          :label-key="(item: CurrencyModel) => formatCurrencyLabel({ code: item.code, fallbackName: item.currency })"
          @update:model-value="(v: any) => (form.expectedCurrencyCode = v?.code ?? '')"
          @blur="touchField('form.expectedCurrencyCode')"
        />
      </div>

      <div v-if="needsInstallmentSchedule" class="border-border bg-muted/20 grid gap-3 rounded-lg border p-3">
        <p class="text-muted-foreground text-xs">
          {{ $t('planned.subscriptions.editors.basics.installmentScheduleRequired') }}
        </p>
        <DateField
          :model-value="form.dueDate ?? undefined"
          :label="$t('planned.subscriptions.editors.basics.firstPaymentDueLabel')"
          :error-message="getFieldErrorMessage('form.dueDate')"
          @update:model-value="(v: Date | null) => (form.dueDate = v)"
        />
        <InputField
          :model-value="form.maxOccurrences ?? undefined"
          type="number"
          :label="$t('planned.subscriptions.form.maxOccurrencesLabel')"
          :placeholder="$t('planned.subscriptions.form.maxOccurrencesInstallmentPlaceholder')"
          :error-message="getFieldErrorMessage('form.maxOccurrences')"
          only-positive
          @update:model-value="(v: string | number | null) => (form.maxOccurrences = v ? Number(v) : null)"
          @blur="touchField('form.maxOccurrences')"
        />
        <p v-if="installmentTotalLabel" class="text-muted-foreground text-xs">
          {{ $t('planned.subscriptions.form.installmentTotalCommitment', { total: installmentTotalLabel }) }}
        </p>
      </div>

      <Callout v-if="formError" variant="destructive">
        <span>{{ formError }}</span>
      </Callout>
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="outline" :disabled="isPending" @click="open = false">
          {{ $t('planned.subscriptions.cancel') }}
        </Button>
        <Button type="submit" form="edit-subscription-basics" :disabled="isPending">
          {{ $t('planned.subscriptions.form.update') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>

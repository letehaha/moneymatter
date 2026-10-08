<script lang="ts" setup>
import { VERBOSE_PAYMENT_TYPES, type VerbosePaymentType } from '@/common/const';
import type { FormattedCategory } from '@/common/types';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import AccountSelectField from '@/components/fields/account-select-field.vue';
import CategorySelectField from '@/components/fields/category-select-field.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import InputField from '@/components/fields/input-field.vue';
import PayeeSelectField from '@/components/fields/payee-select-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import TagSelectField from '@/components/fields/tag-select-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import TransactionTypeToggle from '@/components/fields/transaction-type-toggle.vue';
import { Button } from '@/components/lib/ui/button';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { useNotificationCenter } from '@/components/notification-center';
import { useCurrencyName } from '@/composable';
import { usePayeeLookup } from '@/composable/data-queries/payees';
import {
  useCreateTransactionTemplate,
  useDeleteTransactionTemplate,
  useUpdateTransactionTemplate,
} from '@/composable/data-queries/transaction-templates';
import { useFormValidation } from '@/composable/form-validator';
import { useLinkedCurrencyGroup } from '@/composable/use-linked-currency-group';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { isApiErrorWithCode } from '@/js/errors';
import { useCategoriesStore } from '@/stores';
import { findFormattedCategoryById } from '@/stores/categories/helpers';
import {
  API_ERROR_CODES,
  type AccountModel,
  type CurrencyModel,
  type RecordId,
  TRANSACTION_TYPES,
  type TransactionTemplateModel,
  type CreateTransactionTemplateBody,
} from '@bt/shared/types';
import { required, requiredIf } from '@vuelidate/validators';
import { storeToRefs } from 'pinia';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { TemplateFormMode } from '../../composables/use-transaction-templating';
import type { TemplateFormSources } from '../../utils/template-to-form';
import { TEMPLATE_STALE_REASON_KEYS, getTemplateStaleReason } from './template-staleness';

/** Mirrors the backend's `name` schema, so a seeded name never fails validation on arrival. */
const NAME_MAX_LENGTH = 100;
// Leaves room for the " 2"-style suffix `buildUniqueName` appends.
const SEEDED_NAME_MAX_LENGTH = NAME_MAX_LENGTH - 4;

const props = defineProps<{
  open: boolean;
  mode: TemplateFormMode;
  template?: TransactionTemplateModel | null;
  initial?: Omit<CreateTransactionTemplateBody, 'name'> | null;
  existingNames: string[];
  sources: TemplateFormSources;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  saved: [payload: { template: TransactionTemplateModel; fromCurrentForm: boolean }];
  deleted: [payload: { id: RecordId }];
}>();

const { t } = useI18n();
const { addSuccessNotification } = useNotificationCenter();
const { formattedCategories } = storeToRefs(useCategoriesStore());
const { nameById: payeeNameById } = usePayeeLookup();
const { formatCurrencyLabel } = useCurrencyName();
const linkedCurrencyGroup = useLinkedCurrencyGroup();
const currencyLabel = (item: CurrencyModel): string =>
  formatCurrencyLabel({ code: item.code, fallbackName: item.currency });
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const createMutation = useCreateTransactionTemplate();
const updateMutation = useUpdateTransactionTemplate();
const deleteMutation = useDeleteTransactionTemplate();

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

const isEditingExisting = computed(() => props.mode === 'edit' || props.mode === 'update');
const fromCurrentForm = computed(() => props.mode === 'save-current' || props.mode === 'update');

const title = computed(() => {
  if (props.mode === 'save-current') return t('dialogs.manageTransaction.templates.form.titleSaveCurrent');
  if (props.mode === 'new') return t('dialogs.manageTransaction.templates.form.titleNew');
  return t('dialogs.manageTransaction.templates.form.titleEdit');
});

const emptyTemplateForm = () => ({
  name: '',
  transactionType: TRANSACTION_TYPES.expense,
  account: null as AccountModel | null,
  keepAccount: true,
  amount: null as number | null,
  noAmount: true,
  category: null as FormattedCategory | null,
  payeeId: null as string | null,
  tagIds: [] as string[],
  paymentType: null as VerbosePaymentType | null,
  note: '',
  originalCurrency: null as CurrencyModel | null,
});

const form = ref(emptyTemplateForm());

const nameFieldRef = ref<InstanceType<typeof InputField> | null>(null);
const nameConflictError = ref<string | null>(null);
const isDeleteConfirmOpen = ref(false);

const { isFormValid, getFieldErrorMessage, touchField, resetValidation } = useFormValidation(
  { form },
  { form: { name: { required }, account: { required: requiredIf(() => !form.value.keepAccount) } } },
  {},
  { customValidationMessages: { required: t('dialogs.manageTransaction.form.validation.required') } },
);

const nameErrorMessage = computed(() => nameConflictError.value ?? getFieldErrorMessage('form.name'));

const buildUniqueName = ({ base }: { base: string }) => {
  const seed = base.slice(0, SEEDED_NAME_MAX_LENGTH).trim();
  if (!seed) return '';
  const taken = new Set(props.existingNames.map((name) => name.toLowerCase()));
  if (!taken.has(seed.toLowerCase())) return seed;
  let suffix = 2;
  while (taken.has(`${seed} ${suffix}`.toLowerCase())) suffix += 1;
  return `${seed} ${suffix}`;
};

const seedFrom = ({ source }: { source: Omit<CreateTransactionTemplateBody, 'name'> }) => {
  const account = source.accountId
    ? (props.sources.sourceAccounts.find((item) => item.id === source.accountId) ?? null)
    : null;

  form.value.transactionType = source.transactionType;
  form.value.account = account;
  form.value.keepAccount = source.accountId == null;
  form.value.amount = source.amount ?? null;
  form.value.noAmount = source.amount == null;
  form.value.category = source.categoryId
    ? findFormattedCategoryById(formattedCategories.value, source.categoryId)
    : null;
  form.value.payeeId = source.payeeId ?? null;
  form.value.tagIds = [...(source.tagIds ?? [])];
  form.value.paymentType = VERBOSE_PAYMENT_TYPES.find((item) => item.value === source.paymentType) ?? null;
  form.value.note = source.note ?? '';
  form.value.originalCurrency =
    props.sources.currencies.find((item) => item.code === source.originalCurrencyCode) ?? null;
};

const seedName = () => {
  if (isEditingExisting.value) return props.template?.name ?? '';
  if (props.mode === 'new') return '';
  const payeeName = props.initial?.payeeId ? payeeNameById.value[props.initial.payeeId] : null;
  return buildUniqueName({ base: (payeeName ?? props.initial?.note ?? '').trim() });
};

watch(
  () => props.open,
  (open) => {
    if (!open) return;

    nameConflictError.value = null;
    resetValidation();

    const source = props.initial ?? props.template ?? null;
    if (source) {
      seedFrom({ source });
    } else {
      form.value = emptyTemplateForm();
    }
    form.value.name = seedName();

    // No autofocus on mobile: a selected input blocks vaul's swipe-to-close and pops the keyboard.
    if (!isMobile.value) {
      nextTick(() => {
        nameFieldRef.value?.focus();
        nameFieldRef.value?.select();
      });
    }
  },
);

watch(
  () => form.value.name,
  () => {
    nameConflictError.value = null;
  },
);

// Dropping the pinned account drops the amount: an amount needs the account's currency.
watch(
  () => form.value.keepAccount,
  (keepAccount) => {
    if (!keepAccount) return;
    form.value.noAmount = true;
    form.value.amount = null;
  },
);

watch(
  () => form.value.noAmount,
  (noAmount) => {
    if (noAmount) form.value.amount = null;
  },
);

const staleReason = computed(() =>
  isEditingExisting.value && props.template
    ? getTemplateStaleReason({ template: props.template, sources: props.sources })
    : null,
);

const isPending = computed(
  () => createMutation.isPending.value || updateMutation.isPending.value || deleteMutation.isPending.value,
);

const buildPayload = (): CreateTransactionTemplateBody => {
  const accountId = form.value.keepAccount ? null : (form.value.account?.id ?? null);
  const note = form.value.note.trim();

  return {
    name: form.value.name.trim(),
    transactionType: form.value.transactionType,
    accountId,
    amount: accountId === null || form.value.noAmount ? null : form.value.amount,
    categoryId: form.value.category?.id ?? null,
    payeeId: (form.value.payeeId as RecordId | null) ?? null,
    paymentType: form.value.paymentType?.value ?? null,
    note: note || null,
    originalCurrencyCode: form.value.originalCurrency?.code ?? null,
    tagIds: form.value.tagIds as RecordId[],
  };
};

const save = async () => {
  touchField('form.name');
  touchField('form.account');
  if (!isFormValid('form')) return;

  const payload = buildPayload();

  try {
    const saved =
      isEditingExisting.value && props.template
        ? await updateMutation.mutateAsync({ id: props.template.id, payload })
        : await createMutation.mutateAsync({ payload });

    addSuccessNotification(
      fromCurrentForm.value
        ? t('dialogs.manageTransaction.templates.toasts.savedFromForm', { name: saved.name })
        : t('dialogs.manageTransaction.templates.toasts.saved'),
    );
    emit('saved', { template: saved, fromCurrentForm: fromCurrentForm.value });
    isOpen.value = false;
  } catch (error) {
    if (isApiErrorWithCode(error, API_ERROR_CODES.conflict)) {
      nameConflictError.value =
        error.data.message ?? t('dialogs.manageTransaction.templates.form.duplicateName', { name: payload.name });
    }
  }
};

const confirmDelete = async () => {
  if (!props.template) return;
  const { id } = props.template;

  try {
    await deleteMutation.mutateAsync({ id });
  } catch {
    isDeleteConfirmOpen.value = false;
    return;
  }

  addSuccessNotification(t('dialogs.manageTransaction.templates.toasts.deleted'));
  emit('deleted', { id });
  isDeleteConfirmOpen.value = false;
  isOpen.value = false;
};
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="max-w-125">
    <template #title>{{ title }}</template>

    <div class="flex flex-col gap-3.5">
      <InputField
        ref="nameFieldRef"
        v-model="form.name"
        :maxlength="NAME_MAX_LENGTH"
        :label="$t('dialogs.manageTransaction.templates.form.nameLabel')"
        :placeholder="$t('dialogs.manageTransaction.templates.form.namePlaceholder')"
        :error-message="nameErrorMessage"
        @blur="touchField('form.name')"
      />

      <FieldLabel only-template :label="$t('dialogs.manageTransaction.templates.form.typeLabel')">
        <TransactionTypeToggle v-model="form.transactionType" />
      </FieldLabel>

      <div>
        <AccountSelectField
          v-model="form.account"
          :accounts="sources.sourceAccounts"
          :label="$t('dialogs.manageTransaction.form.accountLabel')"
          :placeholder="$t('dialogs.manageTransaction.form.selectAccountPlaceholder')"
          :error-message="getFieldErrorMessage('form.account')"
          :disabled="form.keepAccount"
        />
        <p v-if="staleReason === 'accountUnavailable'" class="text-warning-text mt-1 px-1 text-xs">
          {{ $t(TEMPLATE_STALE_REASON_KEYS.accountUnavailable) }}
        </p>
        <label class="mt-2 flex min-h-11 items-center gap-2 text-sm">
          <Checkbox v-model="form.keepAccount" />
          {{ $t('dialogs.manageTransaction.templates.form.keepAccount') }}
        </label>
      </div>

      <div>
        <InputField
          v-model="form.amount"
          type="number"
          only-positive
          :label="$t('dialogs.manageTransaction.form.amountLabel')"
          :placeholder="$t('dialogs.manageTransaction.form.amountPlaceholder')"
          :disabled="form.noAmount"
        >
          <template #iconTrailing>
            <span>{{ form.account?.currencyCode }}</span>
          </template>
        </InputField>
        <label class="mt-2 flex min-h-11 items-center gap-2 text-sm">
          <Checkbox v-model="form.noAmount" :disabled="form.keepAccount" />
          {{ $t('dialogs.manageTransaction.templates.form.noAmount') }}
        </label>
      </div>

      <div>
        <CategorySelectField
          v-model="form.category"
          :label="$t('dialogs.manageTransaction.form.categoryLabel')"
          :placeholder="$t('dialogs.manageTransaction.form.selectCategoryPlaceholder')"
          :values="formattedCategories"
          label-key="name"
        />
        <p v-if="staleReason === 'categoryDeleted'" class="text-warning-text mt-1 px-1 text-xs">
          {{ $t(TEMPLATE_STALE_REASON_KEYS.categoryDeleted) }}
        </p>
      </div>

      <PayeeSelectField
        v-model="form.payeeId"
        :label="$t('dialogs.manageTransaction.form.payeeLabel')"
        :account-id="form.account?.id ?? null"
      />

      <TagSelectField v-model="form.tagIds" :label="$t('dialogs.manageTransaction.form.tagsLabel')" />

      <SelectField
        v-model="form.paymentType"
        :label="$t('dialogs.manageTransaction.form.paymentTypeLabel')"
        :values="VERBOSE_PAYMENT_TYPES"
        :label-key="(item) => $t(item.label)"
        clearable
      />

      <SelectField
        v-model="form.originalCurrency"
        :values="sources.currencies"
        :pinned-group="linkedCurrencyGroup"
        :label-key="currencyLabel"
        value-key="code"
        with-search
        clearable
        :label="$t('dialogs.manageTransaction.templates.form.originalCurrencyLabel')"
        :placeholder="$t('dialogs.manageTransaction.templates.form.originalCurrencyPlaceholder')"
      />

      <TextareaField
        v-model="form.note"
        :label="$t('dialogs.manageTransaction.form.noteLabel')"
        :placeholder="$t('dialogs.manageTransaction.form.notePlaceholder')"
      />
    </div>

    <template #footer>
      <div class="flex w-full items-center gap-2">
        <Button
          v-if="isEditingExisting"
          variant="soft-destructive"
          :disabled="isPending"
          @click="isDeleteConfirmOpen = true"
        >
          {{ $t('dialogs.manageTransaction.templates.form.delete') }}
        </Button>
        <Button class="ml-auto" :disabled="isPending" :loading="isPending" @click="save">
          {{ $t('dialogs.manageTransaction.templates.form.save') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>

  <ResponsiveAlertDialog
    v-model:open="isDeleteConfirmOpen"
    :confirm-label="$t('dialogs.manageTransaction.templates.form.delete')"
    confirm-variant="destructive"
    :confirm-disabled="isPending"
    @confirm="confirmDelete"
  >
    <template #title>
      {{ $t('dialogs.manageTransaction.templates.form.deleteConfirmTitle', { name: template?.name ?? '' }) }}
    </template>
    <template #description>
      {{ $t('dialogs.manageTransaction.templates.form.deleteConfirmDescription') }}
    </template>
  </ResponsiveAlertDialog>
</template>

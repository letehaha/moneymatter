import type { FormattedCategory } from '@/common/types';
import { useTransactionTemplates } from '@/composable/data-queries/transaction-templates';
import { formatUIAmount } from '@/js/helpers';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { useCurrenciesStore, useTagsStore } from '@/stores';
import type { AccountModel, RecordId, TransactionTemplateModel, CreateTransactionTemplateBody } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { type MaybeRefOrGetter, computed, nextTick, ref, toValue } from 'vue';
import { useI18n } from 'vue-i18n';

import { getTemplateHiddenFields } from '../components/templates/use-template-list';
import { buildFormattedCategoriesMap } from '../helpers';
import { FORM_TYPES } from '../types';
import { formToTemplate } from '../utils/form-to-template';
import { type TemplateFormSources, isPinnableTemplateAccount } from '../utils/template-to-form';
import { type AppliedTemplateSession, useAppliedTemplate } from './use-applied-template';

export type TemplateFormMode = 'new' | 'edit' | 'save-current' | 'update';

interface TransactionTemplatingOptions {
  session: AppliedTemplateSession;
  isFormCreation: MaybeRefOrGetter<boolean>;
  isReadOnly: MaybeRefOrGetter<boolean>;
  isFormFieldsDisabled: MaybeRefOrGetter<boolean>;
  isAccountsFetched: MaybeRefOrGetter<boolean>;
  isCategoriesReady: MaybeRefOrGetter<boolean>;
  isAccountSharedWithCaller: MaybeRefOrGetter<boolean>;
  /** The account picker's own list, before the template-specific pinnability filter. */
  sourceAccounts: MaybeRefOrGetter<AccountModel[]>;
  formattedCategories: MaybeRefOrGetter<FormattedCategory[]>;
  currencyCode: MaybeRefOrGetter<string | undefined>;
  resetAutoTagTracking: () => void;
  focusAmountField: () => void;
  focusCategoryField: () => void;
  submit: () => void;
}

export const useTransactionTemplating = ({
  session,
  isFormCreation,
  isReadOnly,
  isFormFieldsDisabled,
  isAccountsFetched,
  isCategoriesReady,
  isAccountSharedWithCaller,
  sourceAccounts,
  formattedCategories,
  currencyCode,
  resetAutoTagTracking,
  focusAmountField,
  focusCategoryField,
  submit,
}: TransactionTemplatingOptions) => {
  const { t } = useI18n();
  const { tags: allTags, isFetched: areTagsFetched } = storeToRefs(useTagsStore());
  const { systemCurrencies } = storeToRefs(useCurrenciesStore());
  const form = session.form;

  const isOpen = ref(false);
  // Sticky, so a hover on the trigger starts the load before the popover opens.
  const isRequested = ref(false);
  const {
    list: templates,
    isError,
    isPending,
    refetch,
  } = useTransactionTemplates({
    enabled: () => toValue(isFormCreation) && (isRequested.value || isOpen.value),
  });

  const { applied, missing, apply, adopt, dismiss } = useAppliedTemplate({ session });

  const templateSources = computed<TemplateFormSources>(() => ({
    sourceAccounts: toValue(sourceAccounts).filter((account) => isPinnableTemplateAccount({ account })),
    categoriesMap: buildFormattedCategoriesMap(toValue(formattedCategories)),
    knownTagIds: new Set(allTags.value.map((tag) => tag.id)),
    currencies: systemCurrencies.value,
  }));

  const isVisible = computed(
    () => toValue(isFormCreation) && !toValue(isReadOnly) && form.value.type !== FORM_TYPES.transfer,
  );

  // Applying before the pickers resolve would drop the template's account, category, tags or currency.
  const isDisabled = computed(
    () =>
      !toValue(isAccountsFetched) ||
      !toValue(isCategoriesReady) ||
      !areTagsFetched.value ||
      systemCurrencies.value.length === 0 ||
      toValue(formattedCategories).length === 0,
  );

  const hasUserInput = computed(
    () =>
      form.value.amount != null ||
      Boolean(form.value.payeeId) ||
      Boolean(form.value.note?.trim()) ||
      Boolean(form.value.tagIds?.length) ||
      Boolean(form.value.categoryUserTouched),
  );
  const canSaveCurrent = computed(() => !toValue(isAccountSharedWithCaller) && hasUserInput.value);

  const announcement = ref('');

  const isCategoryDeleted = computed(() => missing.value.includes('category'));

  const hiddenFields = computed(() => (applied.value ? getTemplateHiddenFields({ template: applied.value, t }) : ''));

  const moveFocusAfterApply = () => {
    if (missing.value.includes('category')) {
      focusCategoryField();
      return;
    }
    focusAmountField();
  };

  const announceApplied = ({ template }: { template: TransactionTemplateModel }) => {
    const filledCount = [
      template.accountId,
      template.categoryId,
      template.payeeId,
      template.paymentType,
      template.note,
      template.amount,
      template.tagIds.length ? template.tagIds : null,
    ].filter((value) => value != null).length;

    const text =
      form.value.amount == null
        ? t('dialogs.manageTransaction.templates.announceApplied', { name: template.name, count: filledCount })
        : t('dialogs.manageTransaction.templates.announceAppliedWithAmount', {
            name: template.name,
            count: filledCount,
            amount: formatUIAmount(form.value.amount, { currency: toValue(currencyCode) }),
          });

    // Re-applying the same template produces the same text, which `role="status"` would not
    // announce again. Clearing first makes it a fresh change.
    announcement.value = '';
    nextTick(() => {
      announcement.value = text;
    });
  };

  const doApply = ({ template }: { template: TransactionTemplateModel }) => {
    // Reset first, or the payee watcher retracts earlier auto-applied tags from the
    // template's own tag list.
    resetAutoTagTracking();
    apply({ template, sources: templateSources.value });
    trackAnalyticsEvent({ event: 'transaction_template_applied' });
    announceApplied({ template });
  };

  const pendingApply = ref<TransactionTemplateModel | null>(null);
  const isApplyConfirmOpen = ref(false);
  let isFocusAfterApplyPending = false;

  const onApply = (template: TransactionTemplateModel) => {
    if (form.value.splits?.length || form.value.refundsTx || form.value.refundedByTxs?.length) {
      pendingApply.value = template;
      isApplyConfirmOpen.value = true;
      return;
    }
    doApply({ template });
    isFocusAfterApplyPending = true;
  };

  const onClosedAfterApply = () => {
    if (!isFocusAfterApplyPending) return;
    isFocusAfterApplyPending = false;
    nextTick(moveFocusAfterApply);
  };

  const confirmApply = () => {
    const template = pendingApply.value;
    isApplyConfirmOpen.value = false;
    pendingApply.value = null;
    if (!template) return;
    doApply({ template });
    nextTick(moveFocusAfterApply);
  };

  /** Detaches the template; the values it wrote stay on the form. */
  const detach = () => {
    resetAutoTagTracking();
    dismiss();
    announcement.value = '';
  };

  const editorMode = ref<TemplateFormMode>('new');
  const editorTarget = ref<TransactionTemplateModel | null>(null);
  const editorInitial = ref<Omit<CreateTransactionTemplateBody, 'name'> | null>(null);
  const isEditorOpen = ref(false);
  const existingNames = computed(() => templates.value.map((template) => template.name));

  const openEditor = ({
    mode,
    template = null,
    initial = null,
  }: {
    mode: TemplateFormMode;
    template?: TransactionTemplateModel | null;
    initial?: Omit<CreateTransactionTemplateBody, 'name'> | null;
  }) => {
    editorMode.value = mode;
    editorTarget.value = template;
    editorInitial.value = initial;
    isEditorOpen.value = true;
  };

  const onSaveCurrent = () => openEditor({ mode: 'save-current', initial: formToTemplate({ form: form.value }) });

  const onUpdateApplied = () => {
    const template = applied.value;
    if (!template) return;
    openEditor({ mode: 'update', template, initial: formToTemplate({ form: form.value, base: template }) });
  };

  const onSaved = ({ template, fromCurrentForm }: { template: TransactionTemplateModel; fromCurrentForm: boolean }) => {
    trackAnalyticsEvent({ event: 'transaction_template_saved' });
    if (fromCurrentForm) {
      adopt({ template, mode: 'from-form', sources: templateSources.value });
    } else if (applied.value?.id === template.id) {
      adopt({ template, mode: 'edit', sources: templateSources.value });
    }
  };

  const onDeleted = ({ id }: { id: RecordId }) => {
    if (applied.value?.id === id) detach();
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.altKey && event.code === 'KeyT') {
      if (!isVisible.value || isDisabled.value) return;
      // macOS turns Alt+T into a dead key that would type into the focused field.
      event.preventDefault();
      isOpen.value = !isOpen.value;
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      if (toValue(isReadOnly) || toValue(isFormFieldsDisabled)) return;
      event.preventDefault();
      submit();
    }
  };

  const listProps = computed(() => ({
    open: isOpen.value,
    templates: templates.value,
    applied: applied.value,
    disabled: isDisabled.value,
    canSaveCurrent: canSaveCurrent.value,
    sources: templateSources.value,
    isError: isError.value,
    isLoading: isPending.value,
  }));

  const listHandlers = {
    'update:open': (value: boolean) => {
      isOpen.value = value;
    },
    apply: onApply,
    clear: detach,
    edit: (template: TransactionTemplateModel) => openEditor({ mode: 'edit', template }),
    'save-current': onSaveCurrent,
    'update-current': onUpdateApplied,
    'save-as-new': onSaveCurrent,
    new: () => openEditor({ mode: 'new' }),
    retry: () => refetch(),
    prefetch: () => {
      isRequested.value = true;
    },
    'closed-after-apply': onClosedAfterApply,
  };

  return {
    applied,
    isVisible,
    isCategoryDeleted,
    hiddenFields,
    announcement,
    templateSources,
    listProps,
    listHandlers,
    isApplyConfirmOpen,
    confirmApply,
    detach,
    editor: {
      isOpen: isEditorOpen,
      mode: editorMode,
      target: editorTarget,
      initial: editorInitial,
      existingNames,
      onSaved,
      onDeleted,
    },
    onKeydown,
  };
};

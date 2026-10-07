<script lang="ts" setup>
import { getExchangeRatePair } from '@/api/currencies';
import { loadTransactionById } from '@/api/transactions';
import { OUT_OF_WALLET_ACCOUNT_MOCK, VERBOSE_PAYMENT_TYPES, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { getMaxLoanPayment, isLoanOverpayment, isLoanPaymentPreAnchor } from '@/common/utils/loan-payment';
import { isHttpUrl } from '@/common/utils/external-url';
import { roundCoordinate } from '@/common/utils/coordinates';
import { buildMapUrl } from '@/common/utils/map-url';
import { isMacPlatform } from '@/common/utils/platform';
import { findFormattedCategoryById } from '@/stores/categories/helpers';
import { captureException } from '@/lib/sentry';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import CategorySelectField from '@/components/fields/category-select-field.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import PayeeSelectField from '@/components/fields/payee-select-field.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import SelectField from '@/components/fields/select-field.vue';
import TagSelectField from '@/components/fields/tag-select-field.vue';
import TextareaField from '@/components/fields/textarea-field.vue';
import { Button } from '@/components/lib/ui/button';
import HintIcon from '@/components/common/hint-icon.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { Switch } from '@/components/lib/ui/switch';
import { cn } from '@/lib/utils';
import * as Drawer from '@/components/lib/ui/drawer';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import { useExchangeRates } from '@/composable/data-queries/currencies';
import { useFormValidation } from '@/composable/form-validator';
import { useCurrencyName, useFormatCurrency } from '@/composable/formatters';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { formatUIAmount } from '@/js/helpers';
import { ROUTES_NAMES } from '@/routes/constants';
import { useAccountsStore, useCategoriesStore, useCurrenciesStore, useTagsStore, useUserStore } from '@/stores';
import {
  isDedicatedFlowAccountCategory,
  isTwoLegTransfer,
  ACCOUNT_CATEGORIES,
  ACCOUNT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type AccountModel,
  type CurrencyModel,
  type TransactionLocation,
  type TransactionModel,
} from '@bt/shared/types';
import { useQuery } from '@tanstack/vue-query';
import { between, helpers, maxLength, minValue, required } from '@vuelidate/validators';
import { createReusableTemplate, useEventListener, watchOnce } from '@vueuse/core';
import { endOfDay, format } from 'date-fns';
import {
  ChevronUpIcon,
  CommandIcon,
  CopyIcon,
  CornerDownLeftIcon,
  ExternalLinkIcon,
  LocateIcon,
  MapIcon,
  MapPinIcon,
  SlidersHorizontalIcon,
  SplitIcon,
  XIcon,
} from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { DialogClose, DialogTitle } from 'reka-ui';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import AccountField from './components/account-field.vue';
import AttachmentsSection from './components/attachments-section.vue';
import FormRow from './components/form-row.vue';
import DestinationPanel from './components/destination-panel.vue';
import LinkTransactionSection from './components/link-transaction-section.vue';
import PlannedToggle from './components/planned-toggle.vue';
import PlannedUnlockHint from './components/planned-unlock-hint.vue';
import PortfolioLinkedView from './components/portfolio-linked-view.vue';
import VehicleLinkedView from './components/vehicle-linked-view.vue';
import VentureLinkedView from './components/venture-linked-view.vue';
import MarkAsRefundField from './components/mark-as-refund/mark-as-refund-field.vue';
import AmountWithCurrencyField from './components/amount-with-currency-field.vue';
import LabelPill from './components/label-pill.vue';
import LocationPickerDialog from './components/location-picker-dialog.vue';
import SplitDialog from './components/split-dialog.vue';
import TypeSelector from './components/type-selector.vue';
import TemplateFormDialog from './components/templates/template-form-dialog.vue';
import TemplatesDrawer from './components/templates/templates-drawer.vue';
import TemplatesPanel from './components/templates/templates-panel.vue';
import { openCreateTransactionDialog } from '@/composable/global-state/create-transaction-dialog';
import { useAccountAccess } from '@/composable/use-account-access';
import { useAccountDropdownPrefs } from '@/composable/use-account-dropdown-prefs';
import { useAccountCategories } from '@/composable/data-queries/categories';
import { useLoans } from '@/composable/data-queries/loans';
import { usePortfolios } from '@/composable/data-queries/portfolios';

import {
  getRefundInfo,
  useDeleteTransaction,
  useSubmitTransaction,
  useTransferFormLogic,
  useUnlinkTransactions,
} from './composables';
import type { TransferDestinationType } from './composables/transfer-form';
import { useDefaultPaymentType } from './composables/use-default-payment-type';
import { useMapPickerSetting } from './composables/use-map-picker-setting';
import { useOptionalFields } from './composables/use-optional-fields';
import { useReverseGeocodedLabel } from './composables/use-reverse-geocoded-label';
import { formToCreateMorePrefill } from './utils/form-to-create-more-prefill';
import { formToDuplicatePrefill } from './utils/form-to-duplicate-prefill';
import { canDuplicateTransaction } from './utils/can-duplicate-transaction';
import { resolveFormLocation } from './utils/resolve-form-location';
import { useTransactionTemplating } from './composables/use-transaction-templating';
import { usePayeeTagAutoApply } from '@/composable/use-payee-tag-auto-apply';

import { canDeleteTransaction, isConnectedAccount, isTxEditableAsManual, prepopulateForm } from './helpers';
import { FORM_TYPES, type TransactionPrefill, UI_FORM_STRUCT } from './types';
import { canSuggestOriginalAmount, resolveSuggestedOriginalAmount } from './utils/suggest-original-amount';

defineOptions({
  name: 'record-form',
});

interface CreateRecordModalProps {
  transaction?: TransactionModel;
  oppositeTransaction?: TransactionModel;
  /** Creation-mode starting values, laid over the form defaults. */
  prefill?: TransactionPrefill;
  /** Creation-mode files uploaded to the new row right after it is created. */
  initialAttachments?: File[];
  /** "Create more" toggle; left undefined, the host can't keep the dialog open and the toggle is hidden. */
  createMore?: boolean;
}

const props = withDefaults(defineProps<CreateRecordModalProps>(), {
  transaction: undefined,
  oppositeTransaction: undefined,
  prefill: undefined,
  initialAttachments: () => [],
  createMore: undefined,
});

// Keep `transaction` as the user-facing primary tx (set by useManageTransactionDialog
// — for external transfers, this is always the external side). Form-data mapping
// (which side is "from"/"to") is handled in prepopulateForm based on transactionType,
// so we no longer swap the props.
const transaction = computed(() => props.transaction);
const oppositeTransaction = computed(() => props.oppositeTransaction);

const emit = defineEmits<{
  'close-modal': [];
  created: [result: { transaction: TransactionModel | undefined; attachmentsFailed: boolean }];
  'update:createMore': [value: boolean];
  /** Saved and staying open: the host remounts this content with `prefill` for the next entry. */
  'keep-open': [payload: { prefill: TransactionPrefill }];
}>();
const closeModal = () => {
  emit('close-modal');
};

const isPortfolioLinkedView = computed(
  () => !!props.transaction && props.transaction.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio,
);

const isVentureLinkedView = computed(
  () => !!props.transaction && props.transaction.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_venture,
);

const route = useRoute();
const { t } = useI18n();
watch(() => route.path, closeModal);

const { currenciesMap, systemCurrencies } = storeToRefs(useCurrenciesStore());
const {
  accounts: allAccounts,
  accountsRecord,
  isAccountsFetched,
  txTargetableAccountsActiveFirst,
  txTargetableSourceAccountsActiveFirst,
  plannedTargetableAccountsActiveFirst,
} = storeToRefs(useAccountsStore());

// Vehicle balance-adjustments are reused `transfer_out_wallet` rows on a
// vehicle-category account. Editing them in this generic dialog would let the
// user desync amount/date from Vehicle.valueAnchor (which the override service
// keeps in sync). Lock the form and bounce them to the vehicle detail page.
const isVehicleLinkedView = computed(() => {
  if (!props.transaction) return false;
  if (props.transaction.transferNature !== TRANSACTION_TRANSFER_NATURE.transfer_out_wallet) return false;
  const account = accountsRecord.value[props.transaction.accountId];
  return account?.accountCategory === ACCOUNT_CATEGORIES.vehicle;
});
const { formattedCategories, categoriesMap } = storeToRefs(useCategoriesStore());
const isMac = isMacPlatform();
const { user: currentUser } = storeToRefs(useUserStore());
const tagsStore = useTagsStore();
// Load tags when the dialog opens
tagsStore.loadTags();

const isMobileView = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const isFormCreation = computed(() => !props.transaction);
const { defaultPaymentType } = useDefaultPaymentType();

const form = ref<UI_FORM_STRUCT>({
  amount: null,
  account: null,
  toAccount: null,
  toPortfolio: null,
  portfolioCashAlreadyReflected: false,
  targetAmount: null,
  category: formattedCategories.value[0] ?? null,
  time: new Date(),
  paymentType: defaultPaymentType.value,
  note: undefined,
  externalUrl: undefined,
  externalReference: undefined,
  latitude: undefined,
  longitude: undefined,
  type: FORM_TYPES.expense,
  refundedByTxs: undefined,
  refundsTx: undefined,
  tagIds: [],
  payeeId: null,
  categoryUserTouched: false,
  isPlanned: false,
  originalAmount: null,
  originalCurrency: null,
});

// PayeeField → category auto-fill (one-shot) + tag auto-apply.
// The form is unaware whether the category was set by the user or by Payee
// auto-fill; mark `categoryUserTouched` whenever the user opens the picker so
// later Payee selections respect their intent. The Payee's explicit default
// wins; the top (most-used) category is a fallback so users who never set
// defaults still get a useful suggestion.
//
// Tags use a different model — see `usePayeeTagAutoApply`. In edit mode its
// tracker starts empty, so the row's saved tags count as manual: a payee
// change only adds, never removes. Prepopulation sets `payeeId` without going
// through the clear path, which is consistent with that empty tracker.
const formTagIds = computed({
  get: () => form.value.tagIds ?? [],
  set: (value: string[]) => {
    form.value.tagIds = value;
  },
});
const { onPayeeSelected: applyPayeeTags, reset: resetPayeeTagTracking } = usePayeeTagAutoApply({
  tagIds: formTagIds,
  payeeId: () => form.value.payeeId,
});
const handlePayeeSelected = ({
  defaultCategoryId,
  topCategoryId,
  defaultTagIds,
  defaultLocation,
}: {
  payeeId: string;
  defaultCategoryId: string | null;
  topCategoryId: string | null;
  defaultTagIds: string[];
  defaultLocation: TransactionLocation | null;
}) => {
  applyPayeeTags({ defaultTagIds });

  if (defaultLocation && !isLocationFilled.value) {
    form.value.latitude = defaultLocation.latitude;
    form.value.longitude = defaultLocation.longitude;
  }

  if (form.value.categoryUserTouched) return;
  const targetId = defaultCategoryId ?? topCategoryId;
  if (!targetId) return;
  const match = findFormattedCategoryById(effectiveFormattedCategories.value, targetId);
  if (match) form.value.category = match;
};
const handleCategoryUserTouched = () => {
  form.value.categoryUserTouched = true;
};

const transferDestinationType = ref<TransferDestinationType>('account');

const { data: portfolios } = usePortfolios();

const { addInfoNotification, addErrorNotification, addSuccessNotification } = useNotificationCenter();

const {
  isInitialRefundsDataLoaded,
  initialRefundsFormSlice,
  originalRefunds,
  isOriginalRefundsOverriden,
  refundTransactionsTypeBasedOnFormType,
} = getRefundInfo({
  initialTransaction: props.transaction,
  form,
  onRefundLinkCleared: () => {
    addInfoNotification(t('dialogs.manageTransaction.markAsRefund.linkRemovedOnTypeChange'));
  },
});

watchOnce(
  initialRefundsFormSlice,
  (value) => {
    form.value = Object.assign(form.value, value);
  },
  { deep: true },
);

const linkedTransaction = ref<TransactionModel | null>(null);

// Split dialog state
const isSplitDialogOpen = ref(false);

const hasSplits = computed(() => form.value.splits && form.value.splits.length > 0);
const splitsTotal = computed(() => {
  if (!form.value.splits) return 0;
  return form.value.splits.reduce((sum, split) => sum + (split.amount ?? 0), 0);
});

const isRecordExternal = computed(() => {
  if (!transaction.value) return false;
  // Check the account type, not the transaction type
  // A system transaction in a monobank account should be treated as external
  const account = accountsRecord.value[transaction.value.accountId];
  return (account && account.type !== ACCOUNT_TYPES.system) ?? false;
});
const isOppositeTxExternal = computed(() => {
  if (!oppositeTransaction.value) return false;
  // Check the account type, not the transaction type
  // A system transaction in a monobank account should be treated as external
  const account = accountsRecord.value[oppositeTransaction.value.accountId];
  return (account && account.type !== ACCOUNT_TYPES.system) ?? false;
});
// If record is external (and not a transfer), the account field will be disabled,
// so we need to preselect the account. For transfer cases, prepopulateForm fills
// form.account based on which side is the source – bypassing this preselection.
watch(
  () => isRecordExternal.value,
  (value) => {
    if (!value) return;
    if (transaction.value?.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet) return;
    if (isTwoLegTransfer(transaction.value?.transferNature)) return;

    nextTick(() => {
      if (transaction.value && accountsRecord.value[transaction.value.accountId]) {
        form.value.account = accountsRecord.value[transaction.value.accountId]!;
      }
    });
  },
  { immediate: true },
);

const pendingAttachments = ref<File[]>(props.initialAttachments);

const isCreateMoreAvailable = computed(() => isFormCreation.value && props.createMore !== undefined);
let shouldKeepOpen = false;
let isHandedOffToNextEntry = false;

const submitMutation = useSubmitTransaction({
  onSuccess: ({ created, attachmentsFailed }) => {
    // Emitted for every creation submit: only a plain creation answers with the new row, and a
    // listener that prefilled the form needs to know when it did not get one.
    if (isFormCreation.value) emit('created', { transaction: created, attachmentsFailed: Boolean(attachmentsFailed) });
    if (shouldKeepOpen) {
      addSuccessNotification(t('dialogs.manageTransaction.form.createMore.createdToast'));
      isHandedOffToNextEntry = true;
      emit('keep-open', { prefill: formToCreateMorePrefill({ form: form.value, now: new Date() }) });
      return;
    }
    closeModal();
  },
});
const unlinkMutation = useUnlinkTransactions({ onSuccess: closeModal });
const deleteMutation = useDeleteTransaction({ onSuccess: closeModal });
const isDeleteConfirmOpen = ref(false);

const isLoading = computed(
  () => submitMutation.isPending.value || unlinkMutation.isPending.value || deleteMutation.isPending.value,
);

// Resolve the account whose share state drives auth + category routing. In edit mode
// it's the tx's parent account (immutable in this dialog); in create mode it's whatever
// the user has currently picked in the account-field.
const resolvedAccountId = computed(() => {
  if (transaction.value) return transaction.value.accountId;
  return form.value.account?.id ?? null;
});
const resolvedAccount = computed(() =>
  resolvedAccountId.value != null ? accountsRecord.value[resolvedAccountId.value] : undefined,
);
const {
  share: accountShare,
  isSharedWithCaller: isAccountSharedWithCaller,
  canMutateTx,
} = useAccountAccess(resolvedAccount);

const sharedAccountCategories = useAccountCategories({
  accountId: () => resolvedAccountId.value ?? undefined,
  enabled: isAccountSharedWithCaller,
});

const effectiveFormattedCategories = computed(() =>
  isAccountSharedWithCaller.value ? sharedAccountCategories.formatted.value : formattedCategories.value,
);
const effectiveCategoriesMap = computed(() =>
  isAccountSharedWithCaller.value ? sharedAccountCategories.map.value : categoriesMap.value,
);

// Treat both success and error as terminal so a failed fetch unblocks the form (the
// composable surfaces the error via toast). Without the `isError` branch, prepopulation
// would hang and the dialog would render a permanently-blank edit form on transient
// network failures.
const isCategoriesReady = computed(
  () =>
    !isAccountSharedWithCaller.value ||
    sharedAccountCategories.isSuccess.value ||
    sharedAccountCategories.isError.value,
);
// Until a shared account's categories load, the selected category may belong to another owner.
const isSubmitBlocked = computed(() => isFormCreation.value && !isCategoriesReady.value);

const canMutateCurrentTx = computed(() => canMutateTx(transaction.value, currentUser.value?.id));

// Lazy server-side write-access check, used only when the parent account isn't in the
// caller's local `accountsRecord` — typically when the row is visible via a budget
// share but the account itself isn't shared with the caller. `useAccountAccess` can't
// decide that case (it has nothing to read), and the bulk list path intentionally
// skips `canEdit` to keep common reads cheap. Returns `null` until resolved.
const isAccountLocallyKnown = computed(() => {
  if (!transaction.value) return true;
  return !!accountsRecord.value[transaction.value.accountId];
});
const lazyCanEdit = ref<boolean | null>(null);
watch(
  transaction,
  async (tx) => {
    lazyCanEdit.value = null;
    if (!tx) return;
    if (isAccountLocallyKnown.value) return;
    try {
      const detail = await loadTransactionById({ id: tx.id });
      // Pessimistic default: only unlock the form when the server explicitly says
      // `canEdit: true`. A null detail (caller had no read claim) or a missing field
      // both fall through to read-only — submitting under uncertainty would 403.
      lazyCanEdit.value = detail?.canEdit === true;
    } catch (error) {
      // Form degrades to read-only on failure — the visible state change tells the
      // user the form is locked. Sentry capture surfaces transient failures (auth
      // expiry, server crash, network drop) so ops can distinguish them from a real
      // permission denial. A toast would be noisy on flaky networks.
      lazyCanEdit.value = false;
      captureException({ error, context: { source: 'lazyCanEditProbe', transactionId: tx.id } });
    }
  },
  { immediate: true },
);

// Read-only when the row is editable in principle (some claim) but the lazy check has
// either resolved to "no write" or is still in flight. While loading, we prefer the
// pessimistic "details" view so the user doesn't see an edit button flicker, then
// disappear. For account-locally-known txs we trust the synchronous local check.
const isReadOnly = computed(() => {
  if (!transaction.value) return false;
  if (isAccountLocallyKnown.value) return false;
  if (lazyCanEdit.value === null) return true;
  return !lazyCanEdit.value;
});
const isMutable = computed(() => canMutateCurrentTx.value && !isReadOnly.value);

const isFormFieldsDisabled = computed(() => isLoading.value || !isInitialRefundsDataLoaded.value || !isMutable.value);

const currentTxType = computed(() => form.value.type);
const isTransferTx = computed(() => currentTxType.value === FORM_TYPES.transfer);

// The Loan pill only narrows the picker to loan accounts; the backend stamps transfer_to_loan from the destination's accountCategory.
const isLoanDestination = computed(() => isTransferTx.value && transferDestinationType.value === 'loan');

const loanDestinationAccounts = computed(() =>
  txTargetableAccountsActiveFirst.value.filter((item) => item.accountCategory === ACCOUNT_CATEGORIES.loan),
);

// Transfer kind is frozen on a live pair (backend rejects relabeling) – switching
// the pill mid-edit would 422. Lock it; unlink the transfer first to change destination type.
const isDestinationTypeLocked = computed(() => isTwoLegTransfer(transaction.value?.transferNature));

const {
  isTargetFieldVisible,
  isTargetAmountFieldDisabled,
  targetCurrency,
  fromAccountFieldDisabled,
  toAccountFieldDisabled,
  transferDestinationAccounts,
} = useTransferFormLogic({
  form,
  isTransferTx,
  isRecordExternal,
  isOppositeTxExternal,
  transaction: transaction.value,
  oppositeTransaction: oppositeTransaction.value,
  linkedTransaction,
  transferDestinationType,
});

// TODO:
// 1. Tx creation, validate that refAmount is less than refund refAmount. Use useFormValidation for
// that
// 2. When tx is opened, fetch refund, if there's any. For refund keep "Refund of", for base
// call it "Refunded by"
// 3. When editing, validate refAmount in the same way

const isEditableAsManual = computed(() =>
  isTxEditableAsManual({ transaction: transaction.value, isRecordExternal: isRecordExternal.value }),
);

const isAmountFieldDisabled = computed(() => {
  if (!isEditableAsManual.value) {
    if (!isTransferTx.value) return true;
    if (transaction.value?.transactionType === TRANSACTION_TYPES.expense) {
      return true;
    }
  }
  // Means it's "Out of wallet"
  if (form.value.account?.id === OUT_OF_WALLET_ACCOUNT_MOCK.id) return true;
  if (isTransferTx.value && linkedTransaction.value) return true;
  return false;
});

// Only the bank sync confirms a plan on a connected account, so edit mode keeps the
// toggle interactive solely for manual-account plans: turning it off books the money
// for real on save. Plans on accounts shared *with* the caller belong to the owner only.
const isSavedManualPlanTogglable = computed(
  () =>
    !isFormCreation.value &&
    Boolean(transaction.value?.isPlanned) &&
    transaction.value?.accountType === ACCOUNT_TYPES.system &&
    !isAccountSharedWithCaller.value,
);

// Loan and vehicle balances are recomputed by replaying transactions, and plans on
// accounts shared *with* the caller belong to the owner only.
const isPlannedToggleVisible = computed(() => {
  if (!isFormCreation.value) return isSavedManualPlanTogglable.value;
  if (isTransferTx.value) return false;
  if (isAccountSharedWithCaller.value) return false;
  // The toggle is what unlocks bank-connected accounts in the picker, so an empty picker
  // must not hide it. Only a user with no accounts at all has nothing to plan against.
  if (!allAccounts.value?.length) return false;
  const account = resolvedAccount.value;
  if (!account) return true;
  return !isDedicatedFlowAccountCategory(account.accountCategory);
});

const isPlannedBadgeVisible = computed(
  () => !isFormCreation.value && Boolean(form.value.isPlanned) && !isSavedManualPlanTogglable.value,
);

// Real transactions on a bank-connected account come from the sync, so the account picker
// only offers those once the row is a plan.
const isSelectedAccountConnected = computed(() => {
  const account = resolvedAccount.value;
  if (!account) return false;
  return isConnectedAccount({ account });
});

const nonTransferSourceAccounts = computed(() =>
  form.value.isPlanned ? plannedTargetableAccountsActiveFirst.value : txTargetableSourceAccountsActiveFirst.value,
);

const hasConnectedAccountsToOffer = computed(() =>
  plannedTargetableAccountsActiveFirst.value.some((account) => account.type !== ACCOUNT_TYPES.system),
);

// Turning the mode off strands both fields it had unlocked, so the tooltip warns before
// the click rather than explaining the empty account afterwards. In edit mode the toggle
// means "the money actually moved", which deserves its own wording.
const plannedTooltipOverride = computed(() => {
  if (!isFormCreation.value) return t('dialogs.manageTransaction.form.plannedConfirmTooltip');
  return isSelectedAccountConnected.value
    ? t('dialogs.manageTransaction.form.plannedConnectedAccountTooltip')
    : undefined;
});

watch(isPlannedToggleVisible, (isVisible) => {
  // Edit mode: visibility only shifts while shared-account access resolves; the saved
  // flag must survive that, so only creation-mode account switches reset it.
  if (!isFormCreation.value) return;
  if (isVisible || !form.value.isPlanned) return;
  form.value.isPlanned = false;
  addInfoNotification(t('dialogs.manageTransaction.form.plannedUnavailableNotification'));
});

// In edit mode `isPlanned` mirrors the saved row, so nothing here may touch it. The accounts
// store resolves the account after mount, and stamping the flag on an already-saved
// bank-synced row makes the update fail.
watch(isSelectedAccountConnected, (isConnected) => {
  if (!isFormCreation.value) return;
  if (!isConnected || !isPlannedToggleVisible.value) return;
  form.value.isPlanned = true;
});

// A future date is legitimate on a planned row, and plain rows in the wild already carry
// them, so only a date the user edits after unchecking gets validated.
const isDateUserTouched = ref(false);
const wasPlannedUnchecked = ref(false);

// Turning the mode off (or losing it to a type switch) strands the two things it had
// unlocked: a connected account the picker no longer offers, and a future date. Clear both
// so the user re-picks deliberately instead of submitting a shape the backend rejects.
watch(
  () => form.value.isPlanned,
  (isPlanned, wasPlanned) => {
    if (isPlanned) return;
    if (wasPlanned) wasPlannedUnchecked.value = true;

    if (isSelectedAccountConnected.value) {
      form.value.account = null;
    }

    if (form.value.time && form.value.time.getTime() > Date.now()) {
      form.value.time = new Date();
    }
  },
);

const isPastDateRequired = computed(
  () => wasPlannedUnchecked.value && isDateUserTouched.value && !form.value.isPlanned,
);

const isCurrenciesDifferent = computed(() => {
  if (!form.value.account || !form.value.toAccount) return false;

  return form.value.account.currencyCode !== form.value.toAccount.currencyCode;
});

const currencyCode = computed(() => {
  const accountCurrencyCode = form.value.account?.currencyCode;
  if (accountCurrencyCode) {
    return currenciesMap.value[accountCurrencyCode]?.currency?.code;
  }
  return undefined;
});

const { formatAmountByCurrencyCode } = useFormatCurrency();
const { convert: convertCurrency, data: exchangeRates } = useExchangeRates();

// --- Transfer → Loan payment guards ---

// Credit already reflected in the loan's balance for THIS specific payment –
// mirrors the backend's `currentLegAmount`/`isSameDestination` pair in
// `updateTransaction`: a leg only counts when it already landed as an income
// row on the currently-selected loan account. Re-pointing to a different loan,
// or promoting a plain (never-transferred) transaction into a loan payment,
// starts from zero credit, since no prior write touched that account's
// balance. Naturally 0 in creation mode too (`transaction`/`oppositeTransaction`
// are both undefined there).
const existingLoanLegAmount = computed(() => {
  const loanAccountId = form.value.toAccount?.id;
  if (!loanAccountId) return 0;
  const existingLeg = [transaction.value, oppositeTransaction.value].find(
    (tx) => tx?.transactionType === TRANSACTION_TYPES.income && tx.accountId === loanAccountId,
  );
  return existingLeg?.amount ?? 0;
});

// Form accounts are snapshots; balances must come from the store so they follow refetches after a save.
const liveAccount = ({ account }: { account: AccountModel | null | undefined }) =>
  account ? (accountsRecord.value[account.id] ?? account) : account;

// Largest payment that keeps the destination loan at or above zero.
const loanOverpayMax = computed(() =>
  getMaxLoanPayment({
    loanCurrentBalance: liveAccount({ account: form.value.toAccount })?.currentBalance ?? 0,
    existingLegAmount: existingLoanLegAmount.value,
  }),
);

// Inline overpay guard, mirroring the dedicated payment dialog so the user
// sees the exact remaining balance inline instead of a figureless toast after
// submit. Active for both creation and edits (e.g. promoting an existing
// transaction into a loan payment via the type/destination pickers) –
// `existingLoanLegAmount` above keeps the threshold aligned with the
// backend's row-locked guard in either case.
const isLoanOverpayCheckActive = computed(() => isLoanDestination.value && !!form.value.toAccount);

// Soft warning when a loan payment would overdraw the source. Only flags a positive
// balance going negative – credit lines already in the red overdraw by design. Non-blocking.
const wouldOverdrawLoanSource = computed(() => {
  if (!isLoanDestination.value) return false;
  const account = liveAccount({ account: form.value.account });
  if (!account) return false;
  const amount = Number(form.value.amount);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  return account.currentBalance >= 0 && amount > account.currentBalance;
});

// Reuses the Loans page's TanStack Query cache – no extra request fires when the dialog opens.
const { data: loansData } = useLoans();

// Hint: tx date is before the loan's balance anchor date, so this payment is already
// baked into the opening snapshot and won't adjust the outstanding balance.
const isPreAnchorLoanPayment = computed(() => {
  if (!isLoanDestination.value) return false;
  const toAccountId = form.value.toAccount?.id;
  if (!toAccountId) return false;
  const loan = loansData.value?.find((l) => l.id === toAccountId);
  return isLoanPaymentPreAnchor({
    paymentDate: form.value.time,
    balanceAnchorDate: loan?.loanDetails.balanceAnchorDate,
  });
});

// Pre-fills the loan-currency target from the live rate so cross-currency payments
// default to the converted amount. Reruns on each Amount blur; a hand-typed value survives.
const prefillLoanTargetAmount = () => {
  if (!isLoanDestination.value || !isCurrenciesDifferent.value) return;
  if (form.value.amount == null) return;
  const sourceCode = form.value.account?.currencyCode;
  const loanCode = form.value.toAccount?.currencyCode;
  if (!sourceCode || !loanCode) return;
  const converted = convertCurrency({ amount: Number(form.value.amount), from: sourceCode, to: loanCode });
  if (converted == null) return;
  form.value.targetAmount = converted;
};

watch(transferDestinationType, (type, prev) => {
  if (type === 'portfolio') {
    form.value.toAccount = null;
    return;
  }
  // Auto-pick first loan on switch to 'loan' unless already selected (edit prepop runs first).
  // Clear toAccount on exit so a loan selection doesn't leak into the account picker.
  form.value.toPortfolio = null;
  form.value.portfolioCashAlreadyReflected = false;
  if (type === 'loan' && prev !== 'loan') {
    if (form.value.toAccount?.accountCategory !== ACCOUNT_CATEGORIES.loan) {
      form.value.toAccount = loanDestinationAccounts.value[0] ?? null;
    }
  } else if (prev === 'loan' && type !== 'loan') {
    form.value.toAccount = null;
  }
});

watch(
  () => [currentTxType.value, linkedTransaction.value],
  ([txType, isLinked], [prevTxType]) => {
    if (txType !== FORM_TYPES.transfer) {
      transferDestinationType.value = 'account';
      form.value.toPortfolio = null;
      form.value.portfolioCashAlreadyReflected = false;
    }
    if (transaction.value) {
      // If it's a transaction coming from props it means user currectly edits the form.
      // When switching between transfer type and others we need to keep consistent fields
      // fulfillment
      const { amount, transactionType, accountId, transferNature } = transaction.value;

      if (isLinked) {
        form.value.amount = amount;
        form.value.account = accountsRecord.value[accountId] ?? null;
      } else if (txType === FORM_TYPES.transfer) {
        if (transactionType === TRANSACTION_TYPES.income) {
          form.value.targetAmount = amount;
          form.value.amount = null;

          form.value.toAccount = accountsRecord.value[accountId] ?? null;
          form.value.account = null;

          if (transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet) {
            form.value.account = OUT_OF_WALLET_ACCOUNT_MOCK;
          } else if (oppositeTransaction.value) {
            // Restore the source (expense) side from the opposite transaction so the
            // form keeps the previously known source values (e.g. when re-entering
            // transfer mode after toggling income → transfer for an external income tx).
            form.value.amount = oppositeTransaction.value.amount;
            form.value.account = accountsRecord.value[oppositeTransaction.value.accountId] ?? null;
          }
        }
      } else if (prevTxType === FORM_TYPES.transfer) {
        if (transactionType === TRANSACTION_TYPES.income) {
          form.value.amount = amount;
          form.value.targetAmount = null;

          form.value.account = accountsRecord.value[accountId] ?? null;
          form.value.toAccount = null;
        }
      }
    }
  },
);

// In transfer mode, when source and destination accounts share the same currency,
// mirror the missing side from the populated one. Covers the income → transfer
// edit flow where `amount` starts empty after the user picks a source account.
watch(
  () => [form.value.account?.currencyCode, form.value.toAccount?.currencyCode] as const,
  ([fromCurrency, toCurrency]) => {
    if (!isTransferTx.value) return;
    if (!fromCurrency || !toCurrency) return;
    if (fromCurrency !== toCurrency) return;

    if (form.value.amount == null && form.value.targetAmount != null) {
      form.value.amount = form.value.targetAmount;
    } else if (form.value.targetAmount == null && form.value.amount != null) {
      form.value.targetAmount = form.value.amount;
    }
  },
);

const isAmountRequired = computed(() => !isAmountFieldDisabled.value);
const isTargetAmountRequired = computed(
  () =>
    isTargetFieldVisible.value &&
    !isTargetAmountFieldDisabled.value &&
    // When currencies match, the watcher above mirrors the missing side, so requiring
    // both would surface a redundant error before the mirror has a chance to run.
    isCurrenciesDifferent.value,
);

/**
 * Presence check for the amount fields. Vuelidate's `required` treats 0 as
 * empty, and a zero amount is a real transaction here — an imported Microsoft
 * Money voided cheque lands at 0 and must stay editable — so only a genuinely
 * blank field counts as missing.
 */
const isAmountFilled = (value: unknown) => value !== null && value !== undefined && value !== '';

// Wrap the entire structure in one computed so the rules lookup inside
// `getFieldErrorMessage` (which uses lodash get on the original rules object)
// resolves through `rules.value.form.amount` instead of failing on a nested
// ComputedRef and silently dropping the error message.
const validationRules = computed(() => {
  // Cross-currency loan payments validate targetAmount; same-currency ones validate Amount directly.
  const loanOverpayRule = helpers.withMessage(
    () =>
      t('dialogs.loanPayment.overpayError', {
        max: formatAmountByCurrencyCode(loanOverpayMax.value, form.value.toAccount?.currencyCode ?? ''),
      }),
    (value: unknown) => {
      if (value == null || value === '') return true;
      return !isLoanOverpayment({ amount: Number(value), maxPayment: loanOverpayMax.value });
    },
  );
  // A pre-anchor payment is exempt from the overpay guard on the backend (it never
  // enters the post-anchor balance sum), so mirror that and skip the rule here too.
  const overpayActive = isLoanOverpayCheckActive.value && !isPreAnchorLoanPayment.value;
  const overpayOnAmount = overpayActive && !isCurrenciesDifferent.value;
  const overpayOnTarget = overpayActive && isCurrenciesDifferent.value;

  return {
    form: {
      amount: {
        ...(isAmountRequired.value ? { required: isAmountFilled, minValue: minValue(0) } : {}),
        ...(overpayOnAmount ? { notOverpay: loanOverpayRule } : {}),
      },
      targetAmount: {
        ...(isTargetAmountRequired.value ? { required: isAmountFilled, minValue: minValue(0) } : {}),
        ...(overpayOnTarget ? { notOverpay: loanOverpayRule } : {}),
      },
      category: {
        ...(isTransferTx.value ? {} : { required }),
      },
      time: {
        ...(isPastDateRequired.value
          ? {
              notFutureDate: helpers.withMessage(
                () => t('dialogs.manageTransaction.form.validation.futureDate'),
                (value: unknown) => !(value instanceof Date) || value.getTime() <= endOfDay(new Date()).getTime(),
              ),
            }
          : {}),
      },
      note: {
        maxLength: maxLengthRule(1000),
      },
      externalUrl: {
        maxLength: maxLengthRule(2048),
        httpUrl: helpers.withMessage(
          () => t('dialogs.manageTransaction.form.validation.httpUrl'),
          (value: unknown) => !value || (typeof value === 'string' && isHttpUrl(value.trim())),
        ),
      },
      externalReference: {
        maxLength: maxLengthRule(255),
      },
      latitude: {
        pairedWithLongitude: locationPairRule(() => form.value.longitude),
        between: helpers.withMessage(
          () => t('dialogs.manageTransaction.form.validation.latitudeRange'),
          between(-90, 90),
        ),
      },
      longitude: {
        pairedWithLatitude: locationPairRule(() => form.value.latitude),
        between: helpers.withMessage(
          () => t('dialogs.manageTransaction.form.validation.longitudeRange'),
          between(-180, 180),
        ),
      },
    },
  };
});

function maxLengthRule(max: number) {
  return helpers.withMessage(() => t('dialogs.manageTransaction.form.validation.maxLength', { max }), maxLength(max));
}

// Latitude and longitude only make sense as a pair, so an empty one fails while its partner is filled.
function locationPairRule(partner: () => number | null | undefined) {
  return helpers.withMessage(
    () => t('dialogs.manageTransaction.form.validation.locationPair'),
    (value: unknown) => value != null || partner() == null,
  );
}

const { isFormValid, getFieldErrorMessage, touchField } = useFormValidation(
  { form },
  validationRules,
  {},
  {
    customValidationMessages: {
      required: t('dialogs.manageTransaction.form.validation.required'),
      minValue: t('dialogs.manageTransaction.form.validation.minValue'),
    },
  },
);

const amountErrorMessage = computed(() => getFieldErrorMessage('form.amount'));
const categoryErrorMessage = computed(() => getFieldErrorMessage('form.category'));
const targetAmountErrorMessage = computed(() => getFieldErrorMessage('form.targetAmount'));
const timeErrorMessage = computed(() => getFieldErrorMessage('form.time'));
const noteErrorMessage = computed(() => getFieldErrorMessage('form.note'));
const externalUrlErrorMessage = computed(() => getFieldErrorMessage('form.externalUrl'));
const externalReferenceErrorMessage = computed(() => getFieldErrorMessage('form.externalReference'));
const latitudeErrorMessage = computed(() => getFieldErrorMessage('form.latitude'));
const longitudeErrorMessage = computed(() => getFieldErrorMessage('form.longitude'));

const onAmountBlur = () => {
  touchField('form.amount');
  prefillLoanTargetAmount();
};

const { formatCurrencyLabel } = useCurrencyName();
const currencyOptionLabel = (item: CurrencyModel) =>
  formatCurrencyLabel({ code: item.code, fallbackName: item.currency });

const isOriginalAmountSuggestVisible = computed(
  () =>
    !isFormFieldsDisabled.value &&
    canSuggestOriginalAmount({
      amount: form.value.amount,
      accountCurrencyCode: form.value.account?.currencyCode,
      originalCurrencyCode: form.value.originalCurrency?.code,
      originalAmount: form.value.originalAmount,
    }),
);

const suggestionRateDateStr = computed(() => format(form.value.time, 'yyyy-MM-dd'));

// Background lookup for the inline hint; failures stay silent (no retry, no notification).
// Uses the pair endpoint, not `useExchangeRates().convert`: convert only knows the
// user's linked currencies, and the original currency can be any ISO code.
const suggestionRateQuery = useQuery({
  queryKey: computed(() => [
    ...VUE_QUERY_CACHE_KEYS.exchangeRatePair,
    form.value.account?.currencyCode,
    form.value.originalCurrency?.code,
    suggestionRateDateStr.value,
  ]),
  // `enabled` guarantees both currency codes are set
  queryFn: () =>
    getExchangeRatePair({
      from: form.value.account!.currencyCode,
      to: form.value.originalCurrency!.code,
      date: suggestionRateDateStr.value,
      silent: true,
    }),
  enabled: isOriginalAmountSuggestVisible,
  // Historical rates for a fixed date never change
  staleTime: Infinity,
  retry: false,
});

const suggestedOriginalAmount = computed(() => {
  if (!isOriginalAmountSuggestVisible.value) return null;
  const rate = suggestionRateQuery.data.value?.rate;
  if (rate == null) return null;
  return resolveSuggestedOriginalAmount({
    amount: Number(form.value.amount),
    rate,
    currencyDigits: form.value.originalCurrency?.digits,
  });
});

const applySuggestedOriginalAmount = () => {
  if (suggestedOriginalAmount.value != null) {
    form.value.originalAmount = suggestedOriginalAmount.value;
  }
};

// The field echoes every programmatic write back as an update, so an unchanged
// value must not count as user input.
const onDateUpdate = (value: Date) => {
  if (value.getTime() === form.value.time?.getTime()) return;
  form.value.time = value;
  isDateUserTouched.value = true;
  touchField('form.time');
};

// Rates load async – fill the loan target once they arrive, but only if still empty so a manual entry isn't clobbered.
watch(exchangeRates, () => {
  if (form.value.targetAmount != null) return;
  prefillLoanTargetAmount();
});

const submit = ({ keepOpen = false }: { keepOpen?: boolean } = {}) => {
  if (isSubmitBlocked.value) return;
  touchField('form.amount');
  touchField('form.targetAmount');
  touchField('form.time');
  touchField('form.category');
  touchField('form.note');
  touchField('form.externalUrl');
  touchField('form.externalReference');

  if (!isFormValid('form')) return;

  shouldKeepOpen = isCreateMoreAvailable.value && (keepOpen || Boolean(props.createMore));
  submitMutation.mutate({
    form: form.value,
    isFormCreation: isFormCreation.value,
    isTransferTx: isTransferTx.value,
    isCurrenciesDifferent: isCurrenciesDifferent.value,
    isOriginalRefundsOverriden: isOriginalRefundsOverriden.value,
    isRecordExternal: isRecordExternal.value,
    transaction: transaction.value,
    linkedTransaction: linkedTransaction.value,
    oppositeTransaction: oppositeTransaction.value,
    pendingAttachments: pendingAttachments.value,
  });
};

const unlinkTransactions = () => {
  if (!transaction.value) return;
  unlinkMutation.mutate({
    transferIds: [transaction.value.transferId],
    transactionId: transaction.value.id,
    oppositeTransactionId: oppositeTransaction.value?.id,
  });
};

const canDelete = computed(() =>
  canDeleteTransaction({
    transaction: transaction.value,
    oppositeTransaction: oppositeTransaction.value,
    accounts: accountsRecord.value,
    canMutate: isMutable.value,
  }),
);

const deleteTransactionHandler = () => {
  if (!canDelete.value) return;
  deleteMutation.mutate({
    transactionId: transaction.value!.id,
  });
};

const selectTransactionType = (type: FORM_TYPES, disabled = false) => {
  if (disabled) return;
  // A template pins a type, so a type change drops the pill but keeps what the user is
  // looking at: restoring the snapshot would undo the fields they came here to edit.
  if (templating.applied.value && type !== form.value.type) templating.detach();
  form.value.type = type;
};

// Stores element that was focused before modal was opened, to then focus it back
// when modal will be closed
const previouslyFocusedElement = ref(document.activeElement);

const [DefineMoreOptions, ReuseMoreOptions] = createReusableTemplate();

const { isEnabled: isOptionalFieldEnabled } = useOptionalFields();

// Snapshot: the host clears its prefill on close, while this content stays mounted through the exit animation.
const initialPrefill = props.prefill;

const showExternalUrl = computed(
  () => isOptionalFieldEnabled('externalUrl') || !!props.transaction?.externalUrl || !!initialPrefill?.externalUrl,
);
const showExternalReference = computed(
  () =>
    isOptionalFieldEnabled('externalReference') ||
    !!props.transaction?.externalReference ||
    !!initialPrefill?.externalReference,
);
const showOriginalAmount = computed(
  () =>
    isOptionalFieldEnabled('originalAmount') ||
    props.transaction?.originalAmount != null ||
    initialPrefill?.originalAmount != null,
);
const isLocationFilled = computed(() => form.value.latitude != null || form.value.longitude != null);
const showLocation = computed(
  () => isOptionalFieldEnabled('location') || !!props.transaction?.location || isLocationFilled.value,
);
const externalUrlHref = computed(() => {
  const value = form.value.externalUrl?.trim();
  return value && isHttpUrl(value) ? value : null;
});

const locationMapUrl = computed(() => {
  const location = resolveFormLocation(form.value);
  return location ? buildMapUrl(location) : null;
});

const isLocating = ref(false);
const useCurrentLocation = () => {
  if (!navigator.geolocation) {
    addErrorNotification(t('dialogs.manageTransaction.form.location.unsupported'));
    return;
  }
  isLocating.value = true;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      form.value.latitude = roundCoordinate({ value: coords.latitude });
      form.value.longitude = roundCoordinate({ value: coords.longitude });
      isLocating.value = false;
    },
    (error) => {
      const key = error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable';
      addErrorNotification(t(`dialogs.manageTransaction.form.location.${key}`));
      isLocating.value = false;
    },
    { enableHighAccuracy: true, timeout: 10_000 },
  );
};
const clearLocation = () => {
  form.value.latitude = null;
  form.value.longitude = null;
};

const { enabled: isMapPickerEnabled } = useMapPickerSetting();
const isLocationPickerOpen = ref(false);

const { label: locationLabel, setKnownLabel: setKnownLocationLabel } = useReverseGeocodedLabel({
  latitude: computed(() => form.value.latitude),
  longitude: computed(() => form.value.longitude),
  enabled: isMapPickerEnabled,
});

const applyPickedLocation = ({
  latitude,
  longitude,
  label,
}: {
  latitude: number;
  longitude: number;
  label: string | null;
}) => {
  const rounded = { latitude: roundCoordinate({ value: latitude }), longitude: roundCoordinate({ value: longitude }) };
  form.value.latitude = rounded.latitude;
  form.value.longitude = rounded.longitude;
  setKnownLocationLabel({ ...rounded, label });
};

// Mirrors the visibility conditions of the fields inside "More options" so the
// mobile trigger never counts a field the drawer doesn't render. Payment type is
// excluded – it's always preselected, so it carries no "user filled this" signal.
const moreOptionsFilledCount = computed(() => {
  let count = 0;
  if (form.value.note?.trim()) count += 1;
  if (form.value.externalUrl?.trim()) count += 1;
  if (form.value.externalReference?.trim()) count += 1;
  if (isLocationFilled.value) count += 1;
  if (!isLoanDestination.value && form.value.tagIds?.length) count += 1;
  if (!isTransferTx.value && form.value.originalAmount) count += 1;
  if (
    !isTransferTx.value &&
    !isAccountSharedWithCaller.value &&
    (form.value.refundsTx || form.value.refundedByTxs?.length)
  ) {
    count += 1;
  }
  return count;
});

// Tx prepopulation has to wait for the right category map. For owner-side / unshared txs
// the global Pinia map is loaded synchronously on app boot; for shared-with-caller txs
// we route through `useAccountCategories`, which fires after mount – populate then.
const hasPrepopulated = ref(false);
const { resolveDefaultAccount } = useAccountDropdownPrefs();
const prepopulateIfReady = () => {
  if (hasPrepopulated.value) return;
  // Wait for the first accounts fetch: the query serves `placeholderData: []` until then, and
  // latching on that empty list leaves the account permanently unresolved.
  if (!isAccountsFetched.value) return;
  if (!transaction.value) {
    const accounts = txTargetableSourceAccountsActiveFirst.value;
    // On an account page the open account wins over the favorite one.
    const pageAccount =
      route.name === ROUTES_NAMES.account ? accounts.find((account) => account.id === route.params.id) : undefined;
    form.value.account = pageAccount ?? resolveDefaultAccount({ accounts });
    form.value.paymentType = defaultPaymentType.value;
    Object.assign(form.value, initialPrefill);
    // Keeps the payee auto-fill from replacing a prefilled category.
    form.value.categoryUserTouched = !!initialPrefill?.category;
  } else {
    if (!isCategoriesReady.value) return;
    const data = prepopulateForm({
      transaction: transaction.value,
      oppositeTransaction: oppositeTransaction.value,
      accounts: accountsRecord.value,
      categories: effectiveCategoriesMap.value,
      formattedCategories: effectiveFormattedCategories.value,
      systemCurrencies: systemCurrencies.value,
    });
    if (data) form.value = data;
  }
  // A loan destination switches the picker to the Loan pill so it matches the account.
  if (form.value.toAccount?.accountCategory === ACCOUNT_CATEGORIES.loan) {
    transferDestinationType.value = 'loan';
  }
  hasPrepopulated.value = true;
};

onMounted(prepopulateIfReady);
watch([isCategoriesReady, isAccountsFetched], prepopulateIfReady);

// The category set swaps whenever the picked account moves between own and shared. Drop a
// selection the new set no longer contains, so the required rule blocks Create with a visible
// message instead of posting a categoryId belonging to another owner. A shared set is empty
// while loading, so the check waits for the load to end, failed loads included.
watch([effectiveFormattedCategories, isCategoriesReady], ([categories, isReady]) => {
  if (!isFormCreation.value || !isReady) return;
  const selected = form.value.category;
  if (!selected) {
    if (form.value.categoryUserTouched) return;
    // An applied template that resolved no category must stay empty, not fall back to the first.
    if (templating.applied.value) return;
    form.value.category = categories[0] ?? null;
    return;
  }
  if (effectiveCategoriesMap.value[selected.id]) return;
  form.value.category = null;
});

const amountFieldRef = ref<InstanceType<typeof InputField> | null>(null);
const targetAmountFieldRef = ref<InstanceType<typeof InputField> | null>(null);
const categoryFieldRef = ref<InstanceType<typeof CategorySelectField> | null>(null);

const templating = useTransactionTemplating({
  session: { form, transferDestinationType, linkedTransaction },
  isFormCreation,
  isReadOnly,
  isFormFieldsDisabled,
  isAccountsFetched,
  isCategoriesReady,
  isAccountSharedWithCaller,
  sourceAccounts: txTargetableSourceAccountsActiveFirst,
  // Templates pin the caller's own categories; the shared-account picker swaps to the owner's set.
  formattedCategories,
  currencyCode,
  resetPayeeTagTracking,
  focusAmountField: () => {
    amountFieldRef.value?.focus();
    amountFieldRef.value?.select();
  },
  focusCategoryField: () => categoryFieldRef.value?.focus(),
  submit: () => submit(),
});

const isDuplicateVisible = computed(
  () =>
    !isFormCreation.value &&
    isMutable.value &&
    hasPrepopulated.value &&
    canDuplicateTransaction({
      transferNature: transaction.value?.transferNature,
      form: form.value,
      transferDestinationType: transferDestinationType.value,
      hasLockedLeg: !!linkedTransaction.value || isRecordExternal.value || isOppositeTxExternal.value,
      hasOppositeTransaction: !!oppositeTransaction.value,
      sourceAccounts: txTargetableSourceAccountsActiveFirst.value,
      plannedAccounts: plannedTargetableAccountsActiveFirst.value,
      destinationAccounts: transferDestinationAccounts.value,
    }),
);

const duplicate = () => {
  if (isFormFieldsDisabled.value) return;
  const prefill = formToDuplicatePrefill({ form: form.value, now: new Date() });
  isHandedOffToNextEntry = true;
  closeModal();
  // Lets the host start closing this dialog first, so the two don't fight over scroll lock and focus.
  nextTick(() => openCreateTransactionDialog({ prefill }));
};

// On document so keys pressed inside portaled pickers count, and the browser's bookmark shortcut never fires here.
useEventListener(document, 'keydown', (event: KeyboardEvent) => {
  const isDuplicateHotkey =
    event.code === 'KeyD' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
  if (!isDuplicateHotkey || isFormCreation.value) return;
  event.preventDefault();
  if (isDuplicateVisible.value) duplicate();
});

const onKeydown = (event: KeyboardEvent) => {
  const isCreateMoreHotkey = event.key === 'Enter' && (event.metaKey || event.ctrlKey) && event.shiftKey;
  if (isCreateMoreHotkey && isCreateMoreAvailable.value) {
    event.preventDefault();
    if (!isFormFieldsDisabled.value) submit({ keepOpen: true });
    return;
  }
  templating.onKeydown(event);
};

defineExpose({
  focusAmount: () => (isAmountFieldDisabled.value ? targetAmountFieldRef.value : amountFieldRef.value)?.focus(),
});

onUnmounted(() => {
  // The next entry's content (Create more remount or the duplicate's Add dialog) takes over focus.
  if (isHandedOffToNextEntry) return;
  // A remounted entry captured document.body or a detached node; Reka returns focus to the trigger then.
  const element = previouslyFocusedElement.value;
  if (element && element !== document.body && element.isConnected) (element as HTMLElement).focus();
});
</script>

<template>
  <!-- Define reusable template for "More Options" section (payment type, note, refund) -->
  <DefineMoreOptions>
    <p class="text-muted-foreground mb-3 text-[10px] font-medium tracking-[0.16em] uppercase">
      {{ $t('dialogs.manageTransaction.form.moreOptionsButton') }}
    </p>
    <FormRow v-if="!isLoanDestination">
      <SelectField
        v-model="form.paymentType"
        :label="$t('dialogs.manageTransaction.form.paymentTypeLabel')"
        :disabled="isFormFieldsDisabled || !isEditableAsManual"
        :values="VERBOSE_PAYMENT_TYPES"
        :label-key="(item) => t(item.label)"
      />
    </FormRow>
    <FormRow>
      <TextareaField
        v-model="form.note"
        :placeholder="$t('dialogs.manageTransaction.form.notePlaceholder')"
        :disabled="isFormFieldsDisabled"
        :label="$t('dialogs.manageTransaction.form.noteLabel')"
        :error-message="noteErrorMessage"
        @focusout="touchField('form.note')"
      />
    </FormRow>
    <FormRow v-if="showExternalUrl">
      <InputField
        v-model="form.externalUrl"
        type="url"
        :placeholder="$t('dialogs.manageTransaction.form.externalUrlPlaceholder')"
        :disabled="isFormFieldsDisabled"
        :label="$t('dialogs.manageTransaction.form.externalUrlLabel')"
        :error-message="externalUrlErrorMessage"
        @blur="touchField('form.externalUrl')"
      >
        <template v-if="externalUrlHref" #label-after>
          <DesktopOnlyTooltip :content="$t('common.transactions.record.externalLinkTooltip')">
            <a
              :href="externalUrlHref"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="$t('common.transactions.record.externalLinkTooltip')"
              class="hover:text-foreground flex size-5 items-center justify-center"
            >
              <ExternalLinkIcon class="size-3.5" />
            </a>
          </DesktopOnlyTooltip>
        </template>
      </InputField>
    </FormRow>
    <FormRow v-if="showExternalReference">
      <InputField
        v-model="form.externalReference"
        :placeholder="$t('dialogs.manageTransaction.form.externalReferencePlaceholder')"
        :disabled="isFormFieldsDisabled"
        :label="$t('dialogs.manageTransaction.form.externalReferenceLabel')"
        :error-message="externalReferenceErrorMessage"
        @blur="touchField('form.externalReference')"
      />
    </FormRow>
    <FormRow v-if="showLocation">
      <FieldLabel :label="$t('dialogs.manageTransaction.form.location.label')" only-template>
        <template v-if="locationMapUrl" #label-after>
          <DesktopOnlyTooltip :content="$t('common.transactions.record.locationTooltip')">
            <a
              :href="locationMapUrl"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="$t('common.transactions.record.locationTooltip')"
              class="hover:text-foreground flex size-5 items-center justify-center"
            >
              <MapPinIcon class="size-3.5" />
            </a>
          </DesktopOnlyTooltip>
        </template>
        <template #label-right>
          <div class="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost-primary"
              size="sm"
              class="h-6 px-2 text-xs"
              :disabled="isFormFieldsDisabled || isLocating"
              @click="useCurrentLocation"
            >
              <LocateIcon class="size-3.5" />
              {{ $t('dialogs.manageTransaction.form.location.useCurrent') }}
            </Button>
            <DesktopOnlyTooltip v-if="isLocationFilled" :content="$t('dialogs.manageTransaction.form.location.clear')">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="size-6"
                :disabled="isFormFieldsDisabled"
                :aria-label="$t('dialogs.manageTransaction.form.location.clear')"
                @click="clearLocation"
              >
                <XIcon class="size-3.5" />
              </Button>
            </DesktopOnlyTooltip>
          </div>
        </template>
        <div class="grid grid-cols-[1fr_1fr_auto] gap-2">
          <InputField
            v-model="form.latitude"
            type="number"
            :placeholder="$t('dialogs.manageTransaction.form.location.latitudePlaceholder')"
            :aria-label="$t('dialogs.manageTransaction.form.location.latitudePlaceholder')"
            :disabled="isFormFieldsDisabled"
            :error-message="latitudeErrorMessage"
            @blur="touchField('form.latitude')"
          />
          <InputField
            v-model="form.longitude"
            type="number"
            :placeholder="$t('dialogs.manageTransaction.form.location.longitudePlaceholder')"
            :aria-label="$t('dialogs.manageTransaction.form.location.longitudePlaceholder')"
            :disabled="isFormFieldsDisabled"
            :error-message="longitudeErrorMessage"
            @blur="touchField('form.longitude')"
          />
          <DesktopOnlyTooltip :content="$t('dialogs.manageTransaction.form.location.pickOnMap')">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              class="size-10 shrink-0 md:size-9"
              :disabled="isFormFieldsDisabled"
              :aria-label="$t('dialogs.manageTransaction.form.location.pickOnMap')"
              @click="isLocationPickerOpen = true"
            >
              <MapIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>
        <div v-if="locationLabel" class="text-muted-foreground mt-1.5 flex items-center gap-1 text-xs">
          <MapPinIcon class="size-3 shrink-0" />
          <span class="truncate">{{ locationLabel }}</span>
        </div>
      </FieldLabel>
    </FormRow>
    <LocationPickerDialog
      v-if="showLocation"
      v-model:open="isLocationPickerOpen"
      :latitude="form.latitude"
      :longitude="form.longitude"
      @select="applyPickedLocation"
    />
    <FormRow v-if="!isLoanDestination">
      <TagSelectField
        v-model="form.tagIds"
        :label="$t('dialogs.manageTransaction.form.tagsLabel')"
        :disabled="isFormFieldsDisabled"
      />
    </FormRow>
    <AttachmentsSection
      v-if="transaction?.id || !form.toPortfolio"
      v-model:pending="pendingAttachments"
      :transaction-id="transaction?.id"
      :mirror-transaction-id="isTransferTx ? oppositeTransaction?.id : undefined"
      :disabled="isFormFieldsDisabled"
    />
    <FormRow v-if="!isTransferTx && showOriginalAmount">
      <AmountWithCurrencyField
        v-model:amount="form.originalAmount"
        v-model:currency="form.originalCurrency"
        :currencies="systemCurrencies"
        :option-label="currencyOptionLabel"
        :label="$t('dialogs.manageTransaction.form.originalAmountLabel')"
        :placeholder="$t('dialogs.manageTransaction.form.originalAmountPlaceholder')"
        :disabled="isFormFieldsDisabled"
        :suggest-visible="isOriginalAmountSuggestVisible"
        :suggested-amount="suggestedOriginalAmount"
        :suggested-date="form.time"
        @apply-suggestion="applySuggestedOriginalAmount"
      />
    </FormRow>
    <!-- Refund linking on accounts shared *with* the caller isn't supported by the
         backend yet — hide the field rather than offering a button that errors on
         submit. Owner-side shares (`share.isOwner === true`) keep full access. -->
    <template v-if="!isTransferTx && !isAccountSharedWithCaller">
      <FormRow>
        <MarkAsRefundField
          v-model:refunds="form.refundsTx"
          v-model:refunded-by="form.refundedByTxs"
          :transaction-id="transaction?.id"
          :is-record-creation="isFormCreation"
          :transaction-type="refundTransactionsTypeBasedOnFormType"
          :disabled="isFormFieldsDisabled"
          :is-there-original-refunds="Boolean(originalRefunds.length)"
          :current-transaction-splits="transaction?.splits"
          :current-amount="form.amount ? Number(form.amount) : null"
          :current-currency-code="form.account?.currencyCode"
          :current-category="form.category"
          :current-account-id="form.account?.id"
        />
      </FormRow>
    </template>
  </DefineMoreOptions>

  <PortfolioLinkedView v-if="isPortfolioLinkedView" :transaction="$props.transaction!" @close-modal="closeModal" />
  <VentureLinkedView v-else-if="isVentureLinkedView" :transaction="$props.transaction!" @close-modal="closeModal" />
  <VehicleLinkedView v-else-if="isVehicleLinkedView" :transaction="$props.transaction!" @close-modal="closeModal" />
  <div
    v-else
    class="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] overflow-hidden rounded-t-xl"
    @keydown="onKeydown"
  >
    <p role="status" class="sr-only">{{ templating.announcement.value }}</p>
    <!-- Striped while planned, so the mode stays readable once the toggle scrolls away. -->
    <div
      :class="[
        'h-3 rounded-t-lg transition-[background-color] duration-200 ease-out',
        currentTxType === FORM_TYPES.income && 'bg-app-income-color',
        currentTxType === FORM_TYPES.expense && 'bg-app-expense-color',
        currentTxType === FORM_TYPES.transfer && 'bg-app-transfer-color',
        form.isPlanned &&
          'bg-[repeating-linear-gradient(115deg,transparent_0_7px,var(--planned-stripe)_7px_14px)] bg-size-[14px_14px]',
      ]"
    />
    <div class="mb-2 flex items-center justify-between px-6 py-2.5">
      <div class="flex min-w-0 items-center gap-2">
        <DialogTitle>
          <span class="text-xl">
            {{
              isReadOnly
                ? $t('dialogs.manageTransaction.detailsTitle')
                : isFormCreation
                  ? $t('dialogs.manageTransaction.addTitle')
                  : $t('dialogs.manageTransaction.editTitle')
            }}
          </span>
        </DialogTitle>

        <TemplatesPanel
          v-if="templating.isVisible.value && !isMobileView"
          v-bind="templating.listProps.value"
          v-on="templating.listHandlers"
        />
      </div>

      <DialogClose>
        <Button variant="ghost"> {{ $t('dialogs.manageTransaction.form.closeButton') }} </Button>
      </DialogClose>
    </div>
    <ScrollArea class="min-h-0">
      <div class="relative grid grid-cols-1 md:grid-cols-[450px_minmax(0,1fr)]">
        <div :class="['px-6', isMobileView ? 'pb-1' : 'pb-6']">
          <TemplatesDrawer
            v-if="templating.isVisible.value && isMobileView"
            v-bind="templating.listProps.value"
            v-on="templating.listHandlers"
          />

          <type-selector
            :selected-transaction-type="currentTxType"
            :transaction="transaction"
            :account="transaction ? accountsRecord[transaction.accountId] : undefined"
            :disabled="isFormFieldsDisabled"
            :is-transfer-disabled="Boolean(form.isPlanned)"
            class="mb-6"
            @change-tx-type="selectTransactionType"
          />

          <div>
            <form-row>
              <input-field
                ref="amountFieldRef"
                v-model="form.amount"
                :label="$t('dialogs.manageTransaction.form.amountLabel')"
                type="number"
                :disabled="isFormFieldsDisabled || isAmountFieldDisabled"
                only-positive
                :placeholder="$t('dialogs.manageTransaction.form.amountPlaceholder')"
                :error-message="amountErrorMessage"
                autofocus
                @blur="onAmountBlur"
              >
                <template #iconTrailing>
                  <span>{{ currencyCode }}</span>
                </template>
              </input-field>
            </form-row>

            <p v-if="wouldOverdrawLoanSource" class="text-warning-text -mt-1 px-1 text-xs">
              {{ $t('dialogs.loanPayment.overdrawWarning', { account: form.account?.name ?? '' }) }}
            </p>

            <account-field
              v-model:account="form.account"
              v-model:to-account="form.toAccount"
              v-model:to-portfolio="form.toPortfolio"
              v-model:destination-type="transferDestinationType"
              :disabled="isFormFieldsDisabled"
              :is-transfer-transaction="isTransferTx"
              :is-transaction-linking="!!linkedTransaction"
              :transaction-type="transaction?.transactionType || TRANSACTION_TYPES.expense"
              :accounts="isTransferTx ? txTargetableSourceAccountsActiveFirst : nonTransferSourceAccounts"
              :from-account-disabled="fromAccountFieldDisabled"
              :to-account-disabled="toAccountFieldDisabled"
              :destination-type-disabled="isDestinationTypeLocked"
              :filtered-accounts="transferDestinationAccounts"
              :portfolios="portfolios ?? []"
              :loan-accounts="loanDestinationAccounts"
            >
              <template v-if="isPlannedToggleVisible || isPlannedBadgeVisible" #account-field-right>
                <PlannedToggle
                  variant="addon"
                  :model-value="Boolean(form.isPlanned)"
                  :readonly="isPlannedBadgeVisible"
                  :disabled="isFormFieldsDisabled"
                  :tooltip-override="isPlannedBadgeVisible ? undefined : plannedTooltipOverride"
                  @update:model-value="(value) => (form.isPlanned = value)"
                />
              </template>

              <!-- The zero-accounts fallback renders an input-field, which has no field-right
                   slot — the toggle stays in its label row (and toggling planned there is the
                   path that unlocks connected accounts). -->
              <template v-if="isPlannedToggleVisible || isPlannedBadgeVisible" #account-label-right>
                <PlannedToggle
                  :model-value="Boolean(form.isPlanned)"
                  :readonly="isPlannedBadgeVisible"
                  :disabled="isFormFieldsDisabled"
                  :tooltip-override="isPlannedBadgeVisible ? undefined : plannedTooltipOverride"
                  @update:model-value="(value) => (form.isPlanned = value)"
                />
              </template>

              <template #account-hint>
                <PlannedUnlockHint v-if="isFormCreation && form.isPlanned && hasConnectedAccountsToOffer">
                  {{ $t('dialogs.manageTransaction.form.plannedAccountsUnlockedHint') }}
                </PlannedUnlockHint>
              </template>

              <template #destination-bottom>
                <div
                  v-if="isTransferTx && form.toPortfolio && !isFormCreation && !linkedTransaction"
                  class="flex items-center gap-2"
                >
                  <label class="flex cursor-pointer items-center gap-3">
                    <Checkbox v-model="form.portfolioCashAlreadyReflected" :disabled="isFormFieldsDisabled" />
                    <span class="text-sm leading-none font-medium">
                      {{ $t('dialogs.manageTransaction.form.portfolioCashAlreadyReflectedLabel') }}
                    </span>
                  </label>
                  <HintIcon :content="$t('dialogs.manageTransaction.form.portfolioCashAlreadyReflectedHint')" />
                </div>

                <template v-if="isTargetFieldVisible">
                  <form-row>
                    <input-field
                      ref="targetAmountFieldRef"
                      v-model="form.targetAmount"
                      :disabled="isFormFieldsDisabled || isTargetAmountFieldDisabled"
                      only-positive
                      :label="$t('dialogs.manageTransaction.form.targetAmountLabel')"
                      :placeholder="$t('dialogs.manageTransaction.form.targetAmountPlaceholder')"
                      type="number"
                      :error-message="targetAmountErrorMessage"
                      @blur="touchField('form.targetAmount')"
                    >
                      <template #iconTrailing>
                        <span>{{ targetCurrency?.currency?.code }}</span>
                      </template>
                    </input-field>
                  </form-row>
                </template>

                <!-- Transfer linking on accounts shared *with* the caller isn't supported by
                   the backend yet – hide the linker for recipients rather than letting
                   them trigger a confusing server error. Loan payments never link two
                   pre-existing legs (single source → one loan), so it's irrelevant here. -->
                <LinkTransactionSection
                  v-if="transferDestinationType === 'account' && !isAccountSharedWithCaller"
                  v-model:linked-transaction="linkedTransaction"
                  :is-transfer-tx="isTransferTx"
                  :is-form-creation="isFormCreation"
                  :opposite-transaction="oppositeTransaction"
                  :transaction-type="transaction?.transactionType"
                  :disabled="isFormFieldsDisabled"
                  :origin-transaction-id="transaction?.id"
                  :origin-amount="form.amount ? Number(form.amount) : null"
                  :origin-account-id="form.account?.id"
                  @unlink="unlinkTransactions"
                />
              </template>
            </account-field>

            <!-- Picking a transaction to link collapses account-field to its single-account
               branch (no destination panel), so the pending linked leg gets its own panel. -->
            <template v-if="isTransferTx && linkedTransaction">
              <form-row>
                <DestinationPanel :label="$t('dialogs.manageTransaction.form.destinationGroupLabel')">
                  <LinkTransactionSection
                    v-model:linked-transaction="linkedTransaction"
                    :is-transfer-tx="isTransferTx"
                    :is-form-creation="isFormCreation"
                    :opposite-transaction="oppositeTransaction"
                    :transaction-type="transaction?.transactionType"
                    :disabled="isFormFieldsDisabled"
                    :origin-transaction-id="transaction?.id"
                    :origin-amount="form.amount ? Number(form.amount) : null"
                    :origin-account-id="form.account?.id"
                    @unlink="unlinkTransactions"
                  />
                </DestinationPanel>
              </form-row>
            </template>

            <template v-if="!isTransferTx">
              <form-row>
                <category-select-field
                  ref="categoryFieldRef"
                  v-model="form.category"
                  :label="$t('dialogs.manageTransaction.form.categoryLabel')"
                  :placeholder="$t('dialogs.manageTransaction.form.selectCategoryPlaceholder')"
                  :values="effectiveFormattedCategories"
                  :error-message="categoryErrorMessage"
                  :categories-map="isAccountSharedWithCaller ? effectiveCategoriesMap : undefined"
                  :shared-owner-username="isAccountSharedWithCaller ? accountShare?.owner.username : undefined"
                  label-key="name"
                  :disabled="isFormFieldsDisabled"
                  @update:model-value="handleCategoryUserTouched"
                >
                  <template #field-right>
                    <LabelPill
                      data-test="split-toggle"
                      variant="addon"
                      :active="hasSplits"
                      :disabled="isFormFieldsDisabled"
                      :aria-label="$t('dialogs.manageTransaction.form.splitPillLabel')"
                      @click="isSplitDialogOpen = true"
                    >
                      <SplitIcon class="size-3.5" />
                      {{ $t('dialogs.manageTransaction.form.splitPillLabel') }}
                    </LabelPill>
                  </template>
                </category-select-field>

                <p v-if="templating.isCategoryDeleted.value" class="text-warning-text mt-1 px-1 text-xs">
                  {{ $t('dialogs.manageTransaction.templates.categoryDeletedHint') }}
                </p>

                <Button
                  v-if="hasSplits"
                  type="button"
                  variant="ghost"
                  class="border-border bg-muted/30 hover:bg-muted/50 mt-2 h-auto w-full justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-normal transition-colors"
                  :disabled="isFormFieldsDisabled"
                  @click="isSplitDialogOpen = true"
                >
                  <span class="flex items-center gap-1.5">
                    <SplitIcon class="text-muted-foreground size-3.5" />
                    <span class="font-medium">
                      {{ $t('dialogs.manageTransaction.form.splitInfo', { count: (form.splits?.length ?? 0) + 1 }) }}
                    </span>
                  </span>
                  <span class="text-muted-foreground flex items-center gap-1.5 tabular-nums">
                    {{ formatUIAmount(splitsTotal, { currency: currencyCode }) }}
                    <span aria-hidden="true">·</span>
                    {{ $t('dialogs.manageTransaction.form.editSplit') }}
                  </span>
                </Button>
              </form-row>

              <!-- Split Dialog -->
              <SplitDialog
                v-model:open="isSplitDialogOpen"
                v-model="form.splits"
                :total-amount="form.amount ? Number(form.amount) : null"
                :currency-code="currencyCode"
                :main-category="form.category"
                :categories="effectiveFormattedCategories"
              />

              <TemplateFormDialog
                v-model:open="templating.editor.isOpen.value"
                :mode="templating.editor.mode.value"
                :template="templating.editor.target.value"
                :initial="templating.editor.initial.value"
                :existing-names="templating.editor.existingNames.value"
                :sources="templating.templateSources.value"
                @saved="templating.editor.onSaved"
                @deleted="templating.editor.onDeleted"
              />

              <ResponsiveAlertDialog
                v-model:open="templating.isApplyConfirmOpen.value"
                :confirm-label="$t('dialogs.manageTransaction.templates.use')"
                @confirm="templating.confirmApply"
              >
                <template #title>{{ $t('dialogs.manageTransaction.templates.applyConfirmTitle') }}</template>
                <template #description>
                  {{ $t('dialogs.manageTransaction.templates.applyConfirmDescription') }}
                </template>
              </ResponsiveAlertDialog>
            </template>

            <form-row>
              <date-field
                :model-value="form.time"
                :disabled="isFormFieldsDisabled || !isEditableAsManual"
                :label="$t('dialogs.manageTransaction.form.datetimeLabel')"
                :error-message="timeErrorMessage"
                :calendar-options="{
                  maxDate: form.isPlanned ? undefined : new Date(),
                }"
                @update:model-value="onDateUpdate"
              />

              <PlannedUnlockHint v-if="isFormCreation && form.isPlanned">
                {{ $t('dialogs.manageTransaction.form.plannedDatesUnlockedHint') }}
              </PlannedUnlockHint>
            </form-row>

            <p v-if="isPreAnchorLoanPayment" class="text-muted-foreground -mt-1 px-1 text-xs">
              {{ $t('dialogs.loanPayment.preAnchorHint') }}
            </p>

            <template v-if="currentTxType !== FORM_TYPES.transfer">
              <form-row>
                <payee-select-field
                  v-model="form.payeeId"
                  :label="$t('dialogs.manageTransaction.form.payeeLabel')"
                  :disabled="isFormFieldsDisabled"
                  :account-id="resolvedAccountId"
                  :owner-scoped="isAccountSharedWithCaller"
                  @payee-selected="handlePayeeSelected"
                />
              </form-row>
            </template>
          </div>
        </div>

        <div v-if="!isMobileView" class="bg-muted border-border border-l px-6 py-6 dark:bg-black/20">
          <ReuseMoreOptions />
        </div>
      </div>
    </ScrollArea>

    <template v-if="isMobileView">
      <Drawer.Drawer>
        <Drawer.DrawerTrigger as-child>
          <Button
            variant="ghost"
            class="border-border bg-muted h-auto w-full justify-between rounded-none border-t px-6 py-2.5 font-normal dark:bg-black/20"
          >
            <span class="flex items-center gap-2">
              <SlidersHorizontalIcon class="text-muted-foreground size-4" />
              {{ $t('dialogs.manageTransaction.form.moreOptionsButton') }}
              <span
                v-if="moreOptionsFilledCount"
                class="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] leading-none font-semibold tabular-nums"
              >
                {{ moreOptionsFilledCount }}
              </span>
            </span>
            <ChevronUpIcon class="text-muted-foreground size-4" />
          </Button>
        </Drawer.DrawerTrigger>

        <Drawer.DrawerContent custom-indicator class="pb-0">
          <Drawer.DrawerTitle></Drawer.DrawerTitle>
          <div class="bg-muted rounded-t-[10px] px-6 pb-[env(safe-area-inset-bottom)] dark:bg-black/20">
            <Drawer.DrawerIndicator class="mb-6" />
            <ReuseMoreOptions />
          </div>
        </Drawer.DrawerContent>
      </Drawer.Drawer>

      <p
        v-if="templating.hiddenFields.value"
        class="text-muted-foreground border-border bg-muted border-t px-6 py-1.5 text-xs dark:bg-black/20"
      >
        {{ $t('dialogs.manageTransaction.templates.alsoSet', { fields: templating.hiddenFields.value }) }}
      </p>
    </template>

    <div v-if="!isReadOnly || canDelete" class="border-border bg-dialog flex items-center gap-3 border-t px-6 py-4">
      <Button
        v-if="canDelete"
        class="min-w-25"
        :disabled="isFormFieldsDisabled"
        :aria-label="$t('dialogs.manageTransaction.form.deleteAriaLabel')"
        variant="destructive"
        @click="isDeleteConfirmOpen = true"
      >
        {{ $t('dialogs.manageTransaction.form.deleteButton') }}
      </Button>
      <ResponsiveAlertDialog
        v-model:open="isDeleteConfirmOpen"
        :confirm-label="$t('dialogs.manageTransaction.form.deleteButton')"
        confirm-variant="destructive"
        :confirm-disabled="isFormFieldsDisabled"
        @confirm="deleteTransactionHandler"
      >
        <template #title>{{ $t('dialogs.manageTransaction.form.deleteConfirmTitle') }}</template>
        <template #description>{{ $t('dialogs.manageTransaction.form.deleteConfirmDescription') }}</template>
      </ResponsiveAlertDialog>
      <div class="ml-auto flex items-center gap-2">
        <DesktopOnlyTooltip
          v-if="isDuplicateVisible"
          :content="$t('dialogs.manageTransaction.form.duplicateButton')"
          :disabled="!isMobileView"
        >
          <Button
            variant="outline"
            :size="isMobileView ? 'icon' : 'default'"
            :aria-label="$t('dialogs.manageTransaction.form.duplicateButton')"
            :disabled="isFormFieldsDisabled"
            @click="duplicate"
          >
            <CopyIcon class="size-4" />
            <template v-if="!isMobileView">
              {{ $t('dialogs.manageTransaction.form.duplicateButton') }}
              <kbd
                aria-hidden="true"
                class="text-muted-foreground inline-flex items-center gap-0.5 text-xs font-medium"
              >
                <CommandIcon v-if="isMac" class="size-3" />
                <template v-else>Ctrl</template>
                D
              </kbd>
            </template>
          </Button>
        </DesktopOnlyTooltip>
        <label
          v-if="isCreateMoreAvailable"
          :class="cn('flex items-center gap-2 text-sm whitespace-nowrap', !isFormFieldsDisabled && 'cursor-pointer')"
        >
          <Switch
            :model-value="createMore"
            :disabled="isFormFieldsDisabled"
            @update:model-value="(value: boolean) => emit('update:createMore', value)"
          />
          {{ $t('dialogs.manageTransaction.form.createMore.label') }}
        </label>
        <Button
          v-if="!isReadOnly"
          class="min-w-30"
          :aria-label="
            isFormCreation
              ? $t('dialogs.manageTransaction.form.createAriaLabel')
              : $t('dialogs.manageTransaction.form.editAriaLabel')
          "
          :disabled="isFormFieldsDisabled || isSubmitBlocked"
          @click="submit()"
        >
          {{
            isLoading
              ? $t('dialogs.manageTransaction.form.loadingButton')
              : isFormCreation
                ? $t('dialogs.manageTransaction.form.createButton')
                : $t('dialogs.manageTransaction.form.editButton')
          }}
          <kbd
            v-if="!isMobileView"
            aria-hidden="true"
            class="text-primary-foreground/70 inline-flex items-center gap-0.5 text-xs font-medium"
          >
            <CommandIcon v-if="isMac" class="size-3" />
            <template v-else>Ctrl</template>
            <CornerDownLeftIcon class="size-3" />
          </kbd>
        </Button>
      </div>
    </div>
  </div>
</template>

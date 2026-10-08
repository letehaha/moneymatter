<script setup lang="ts">
import {
  getSubscriptionPayPreview,
  type LinkedPaymentCandidate,
  markSubscriptionPeriodPaid,
  type SubscriptionPayPreview,
} from '@/api/subscriptions';
import { VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { getAccountDisplayLabel } from '@/common/utils/account-display';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { isConnectedAccount } from '@/components/dialogs/manage-transaction/helpers';
import AccountSelectField from '@/components/fields/account-select-field.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Label } from '@/components/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import { useNotificationCenter } from '@/components/notification-center';
import { useInvalidateSubscriptionQueries } from '@/composable/data-queries/subscriptions';
import { useFormatCurrency } from '@/composable/formatters';
import { useAccountDropdownPrefs } from '@/composable/use-account-dropdown-prefs';
import { useDateLocale } from '@/composable/use-date-locale';
import { ApiErrorResponseError } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { useAccountsStore } from '@/stores';
import type { AccountModel } from '@bt/shared/types';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * Minimal subscription shape the pay flow needs. Accepts both list items and
 * detail models since both carry these fields.
 */
interface PayableSubscription {
  id: string;
  name: string;
  /** Decimal expected amount; null means the amount varies per payment. */
  expectedAmount: number | null;
  expectedCurrencyCode: string | null;
  /** Account the generated expense is booked against. null = no account yet. */
  accountId: string | null;
}

/** How the payment is recorded: link an already-linked transaction, status-only, or book a new expense. */
type RecordMode = 'existing' | 'mark' | 'transaction';

const { t } = useI18n();
const queryClient = useQueryClient();
const invalidateSubscriptionQueries = useInvalidateSubscriptionQueries();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const { formatAmountByCurrencyCode } = useFormatCurrency();
const { format } = useDateLocale();
const accountsStore = useAccountsStore();
const { accountsRecord, txTargetableSourceAccountsActiveFirst } = storeToRefs(accountsStore);
const { resolveDefaultAccount } = useAccountDropdownPrefs();

const emit = defineEmits<{
  paid: [];
}>();

const { mutate: markPaid, isPending: isMarkPending } = useMutation({
  mutationFn: markSubscriptionPeriodPaid,
  onSuccess: () => {
    invalidateSubscriptionQueries();
    // Booking an expense creates a transaction, so refresh all transaction-aware queries.
    queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
    addSuccessNotification(t('dialogs.subscriptionMarkPaid.notifications.markedAsPaid'));
    isDialogOpen.value = false;
    emit('paid');
  },
  onError(error) {
    const message =
      error instanceof ApiErrorResponseError
        ? error.data.message
        : t('dialogs.subscriptionMarkPaid.notifications.markAsPaidFailed');
    addErrorNotification(message ?? t('dialogs.subscriptionMarkPaid.notifications.markAsPaidFailed'));
  },
});

// --- Dialog state ---

const isDialogOpen = ref(false);
const activeSubscription = ref<PayableSubscription | null>(null);
const activePeriodId = ref<string | null>(null);
const amount = ref<string>('');
const paidDate = ref<Date>(new Date());
const isPreviewLoading = ref(false);
const isPreviewUnavailable = ref(false);
const estimate = ref<SubscriptionPayPreview | null>(null);
const linkedPayments = ref<LinkedPaymentCandidate[]>([]);
const selectedLinkedPaymentId = ref<string | null>(null);
const today = new Date();

const recordMode = ref<RecordMode>('mark');
const selectedAccountId = ref<string | null>(null);

const isPending = computed(() => isMarkPending.value || isPreviewLoading.value);

const hasAccount = computed(() => activeSubscription.value?.accountId != null);

const isBankAccount = computed(() => {
  const accountId = activeSubscription.value?.accountId;
  const account = accountId ? accountsRecord.value[accountId] : null;
  return !!account && isConnectedAccount({ account });
});

/** Recording choices offered for the active subscription; the radio is shown only when there is more than one. */
const modeOptions = computed<RecordMode[]>(() => {
  const options: RecordMode[] = linkedPayments.value.length > 0 ? ['existing'] : [];
  if (!hasAccount.value) return [...options, 'mark', 'transaction'];
  return [...options, isBankAccount.value ? 'mark' : 'transaction'];
});

const modeLabels = computed<Record<RecordMode, { title: string; description: string }>>(() => ({
  existing: {
    title: 'dialogs.subscriptionMarkPaid.useExistingTitle',
    description: 'dialogs.subscriptionMarkPaid.useExistingDescription',
  },
  mark: {
    title: 'dialogs.subscriptionMarkPaid.recordModeMarkTitle',
    description: 'dialogs.subscriptionMarkPaid.recordModeMarkDescription',
  },
  transaction: hasAccount.value
    ? {
        title: 'dialogs.subscriptionMarkPaid.recordNewTitle',
        description: 'dialogs.subscriptionMarkPaid.recordNewDescription',
      }
    : {
        title: 'dialogs.subscriptionMarkPaid.recordModeTransactionTitle',
        description: 'dialogs.subscriptionMarkPaid.recordModeTransactionDescription',
      },
}));

/** Whether the account/amount/date fields are shown (booking a real transaction). */
const isBooking = computed(() => recordMode.value === 'transaction');

const selectedAccount = computed(() =>
  selectedAccountId.value ? (accountsRecord.value[selectedAccountId.value] ?? null) : null,
);

function accountLabelById({ accountId }: { accountId: string | null | undefined }): string | null {
  const account = accountId ? accountsRecord.value[accountId] : null;
  return account ? getAccountDisplayLabel(account) : null;
}

const accountLabel = computed(() => accountLabelById({ accountId: activeSubscription.value?.accountId }));

function accountCurrencyFor(subscription: PayableSubscription | null): string | null {
  if (!subscription?.accountId) return null;
  return accountsRecord.value[subscription.accountId]?.currencyCode ?? null;
}

function isCrossCurrency(subscription: PayableSubscription): boolean {
  const accountCurrency = accountCurrencyFor(subscription);
  return (
    subscription.expectedCurrencyCode != null &&
    accountCurrency != null &&
    subscription.expectedCurrencyCode !== accountCurrency
  );
}

function candidateTitle({ candidate }: { candidate: LinkedPaymentCandidate }): string {
  return candidate.payeeName || candidate.note || activeSubscription.value?.name || '';
}

/**
 * The booked amount is always denominated in the account's currency. For an
 * account-less subscription that follows the account the user is selecting; it
 * falls back to the subscription's own currency before one is chosen.
 */
const dialogAmountCurrency = computed(() => {
  const sub = activeSubscription.value;
  if (!sub) return null;
  if (sub.accountId == null) {
    if (selectedAccountId.value) return accountsRecord.value[selectedAccountId.value]?.currencyCode ?? null;
    return sub.expectedCurrencyCode ?? null;
  }
  return accountCurrencyFor(sub) ?? sub.expectedCurrencyCode ?? null;
});

const isConfirmDisabled = computed(() => {
  if (isPending.value) return true;
  if (recordMode.value === 'existing') return !selectedLinkedPaymentId.value;
  if (!isBooking.value) return false;
  // Booking against a not-yet-linked account requires picking one.
  if (!hasAccount.value && !selectedAccountId.value) return true;
  return !amount.value || Number(amount.value) <= 0;
});

const confirmLabel = computed(() => {
  if (recordMode.value === 'existing') return t('dialogs.subscriptionMarkPaid.confirmUseExisting');
  return isBooking.value
    ? t('dialogs.subscriptionMarkPaid.confirm')
    : t('dialogs.subscriptionMarkPaid.confirmMarkOnly');
});

/**
 * Entry point. The pay preview is fetched first; a transaction already linked to
 * the subscription inside this period opens the dialog so the user chooses between
 * reusing it and the regular flow. Without one:
 *  - No account: dialog to choose between a plain mark-paid and booking a transaction.
 *  - Bank-connected account: status-only mark-paid; its rows come from the bank sync.
 *  - Fixed same-currency amount: book in one click, no dialog.
 *  - Variable / cross-currency amount: dialog to capture the amount.
 * A failed preview cannot rule out a linked payment, so it never books in one click:
 * the dialog opens on the booking fields instead.
 */
async function triggerPay({ subscription, periodId }: { subscription: PayableSubscription; periodId: string }) {
  // A second call during the preview request would overwrite the active subscription mid-flight.
  if (isPreviewLoading.value) return;

  const crossCurrency = isCrossCurrency(subscription);

  activeSubscription.value = subscription;
  activePeriodId.value = periodId;
  paidDate.value = new Date();
  amount.value = subscription.expectedAmount != null && !crossCurrency ? String(subscription.expectedAmount) : '';
  selectedAccountId.value =
    resolveDefaultAccount({ accounts: txTargetableSourceAccountsActiveFirst.value, fallbackToFirst: false })?.id ??
    null;

  let preview: SubscriptionPayPreview | null = null;
  isPreviewLoading.value = true;
  try {
    preview = await getSubscriptionPayPreview({ id: subscription.id, periodId });
  } catch (error) {
    captureException({ error, context: { source: 'subscriptionMarkPaid.preview', subscriptionId: subscription.id } });
  } finally {
    isPreviewLoading.value = false;
  }

  estimate.value = preview;
  isPreviewUnavailable.value = preview === null;
  linkedPayments.value = preview?.linkedPayments ?? [];
  selectedLinkedPaymentId.value = linkedPayments.value[0]?.id ?? null;
  // Cross-currency: pre-fill the app-converted estimate so the user can adjust if their bank charged a different rate.
  if (crossCurrency && preview?.convertedAmount != null) {
    amount.value = String(preview.convertedAmount);
  }

  if (linkedPayments.value.length > 0) {
    recordMode.value = 'existing';
    isDialogOpen.value = true;
    return;
  }

  if (subscription.accountId == null) {
    recordMode.value = 'mark';
    isDialogOpen.value = true;
    return;
  }

  const account = accountsRecord.value[subscription.accountId];
  if (account && isConnectedAccount({ account })) {
    markPaid({ id: subscription.id, periodId });
    return;
  }

  if (preview && subscription.expectedAmount != null && !crossCurrency) {
    markPaid({ id: subscription.id, periodId, createTransaction: true, time: new Date() });
    return;
  }

  recordMode.value = 'transaction';
  isDialogOpen.value = true;
}

function confirmPay() {
  if (isConfirmDisabled.value || !activeSubscription.value || !activePeriodId.value) return;

  const id = activeSubscription.value.id;
  const periodId = activePeriodId.value;

  if (recordMode.value === 'existing') {
    const transactionId = selectedLinkedPaymentId.value;
    if (!transactionId) return;
    markPaid({ id, periodId, transactionId });
    return;
  }

  if (!isBooking.value) {
    markPaid({ id, periodId });
    return;
  }

  markPaid({
    id,
    periodId,
    createTransaction: true,
    amount: Number(amount.value),
    time: paidDate.value,
    // Pass the picked account only in the account-less flow; the backend links
    // it to the subscription so future payments reuse it.
    ...(!hasAccount.value && selectedAccountId.value ? { accountId: selectedAccountId.value } : {}),
  });
}

defineExpose({ triggerPay, isPending });
</script>

<template>
  <ResponsiveDialog v-model:open="isDialogOpen" dialog-content-class="max-w-md">
    <template #title>{{ $t('dialogs.subscriptionMarkPaid.title') }}</template>
    <template #description>
      <template v-if="linkedPayments.length > 0">
        {{ $t('dialogs.subscriptionMarkPaid.linkedPaymentDescription', { name: activeSubscription?.name }) }}
      </template>
      <template v-else-if="!hasAccount">
        {{ $t('dialogs.subscriptionMarkPaid.chooseDescription', { name: activeSubscription?.name }) }}
      </template>
      <template v-else>
        {{ $t('dialogs.subscriptionMarkPaid.description', { name: activeSubscription?.name }) }}
      </template>
    </template>

    <div class="grid gap-4">
      <p v-if="isPreviewUnavailable" class="text-muted-foreground text-xs">
        {{ $t('dialogs.subscriptionMarkPaid.previewUnavailable') }}
      </p>

      <RadioGroup v-if="modeOptions.length > 1" v-model="recordMode" class="grid gap-3">
        <Label
          v-for="mode in modeOptions"
          :key="mode"
          :class="
            cn(
              'border-input hover:bg-accent hover:text-accent-foreground flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors',
              recordMode === mode && 'border-primary bg-primary/5',
            )
          "
        >
          <div class="flex items-center gap-2">
            <RadioGroupItem :value="mode" />
            <span class="font-medium">{{ $t(modeLabels[mode].title) }}</span>
          </div>
          <span class="text-muted-foreground pl-6 text-xs">{{ $t(modeLabels[mode].description) }}</span>
        </Label>
      </RadioGroup>

      <RadioGroup
        v-if="recordMode === 'existing'"
        v-model="selectedLinkedPaymentId"
        :aria-label="$t('dialogs.subscriptionMarkPaid.useExistingTitle')"
        class="grid gap-2"
      >
        <Label
          v-for="candidate in linkedPayments"
          :key="candidate.id"
          :class="
            cn(
              'border-input hover:bg-accent flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm transition-colors',
              selectedLinkedPaymentId === candidate.id && 'border-primary bg-primary/5',
            )
          "
        >
          <RadioGroupItem :value="candidate.id" />
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="truncate font-medium">{{ candidateTitle({ candidate }) }}</span>
            <span class="text-muted-foreground text-xs">
              {{ format(candidate.time, 'PP') }}
              <template v-if="accountLabelById({ accountId: candidate.accountId })">
                · {{ accountLabelById({ accountId: candidate.accountId }) }}
              </template>
            </span>
          </div>
          <span class="font-medium whitespace-nowrap">
            {{ formatAmountByCurrencyCode(candidate.amount, candidate.currencyCode) }}
          </span>
        </Label>
      </RadioGroup>

      <!-- Booking a real transaction: capture account (when not yet linked), amount, date. -->
      <template v-if="isBooking">
        <AccountSelectField
          v-if="!hasAccount"
          :model-value="selectedAccount"
          :accounts="txTargetableSourceAccountsActiveFirst"
          :label="$t('dialogs.subscriptionMarkPaid.accountLabel')"
          :placeholder="$t('dialogs.subscriptionMarkPaid.accountPlaceholder')"
          @update:model-value="(account: AccountModel | null) => (selectedAccountId = account?.id ?? null)"
        />

        <InputField
          v-model="amount"
          type="number"
          step="0.01"
          min="0.01"
          only-positive
          :label="$t('dialogs.subscriptionMarkPaid.amountLabel')"
          :placeholder="$t('dialogs.subscriptionMarkPaid.amountPlaceholder')"
        >
          <template v-if="dialogAmountCurrency" #iconTrailing>
            <span>{{ dialogAmountCurrency }}</span>
          </template>
        </InputField>

        <p v-if="estimate?.isCrossCurrency && estimate.expectedAmount != null" class="text-muted-foreground text-xs">
          {{
            $t('dialogs.subscriptionMarkPaid.crossCurrencyEstimate', {
              sourceAmount: estimate.expectedAmount,
              sourceCurrency: estimate.subscriptionCurrencyCode,
              accountCurrency: estimate.accountCurrencyCode,
            })
          }}
        </p>

        <DateField
          v-model="paidDate"
          :label="$t('dialogs.subscriptionMarkPaid.dateLabel')"
          :calendar-options="{ maxDate: today }"
        />

        <div v-if="accountLabel" class="bg-muted/40 rounded-md px-3 py-2 text-sm">
          <p class="text-muted-foreground text-xs">{{ $t('dialogs.subscriptionMarkPaid.accountLabel') }}</p>
          <p class="font-medium">{{ accountLabel }}</p>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UiButton variant="outline" :disabled="isPending" @click="isDialogOpen = false">
          {{ $t('common.actions.cancel') }}
        </UiButton>
        <UiButton :disabled="isConfirmDisabled" :loading="isPending" @click="confirmPay">
          {{ confirmLabel }}
        </UiButton>
      </div>
    </template>
  </ResponsiveDialog>
</template>

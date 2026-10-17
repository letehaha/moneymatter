<script setup lang="ts">
import { uploadTransactionAttachment } from '@/api/attachments';
import { matchInvoice, rematchInvoice } from '@/api/invoice-matching';
import { editTransaction, loadTransactionById } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { compressImages } from '@/common/utils/compress-image';
import PlanRestricted from '@/components/billing/plan-restricted.vue';
import AiUsageBadge from '@/components/common/ai-usage/ai-usage-badge.vue';
import { FileDropzone } from '@/components/common/dropzone';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import type { TransactionPrefill } from '@/components/dialogs/manage-transaction/types';
import PickTransactionDialog from '@/components/dialogs/pick-transaction-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import TransactionDetailsModal from '@/components/transactions-list/transaction-details-modal.vue';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { useExchangeRates } from '@/composable/data-queries/currencies';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { useAccountDropdownPrefs } from '@/composable/use-account-dropdown-prefs';
import { useAiAllowance } from '@/composable/use-ai-allowance';
import { useIsAiUsageExitPage } from '@/composable/use-close-dialog-when';
import { useDateLocale } from '@/composable/use-date-locale';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { formatUIAmount } from '@/js/helpers';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { captureException } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { useAccountsStore, useCurrenciesStore, useUserStore } from '@/stores';
import {
  AI_FEATURE,
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_MIME_TYPES,
  type ExtractedInvoice,
  FEATURES,
  FEATURE_TRIAL_LIMITS,
  invoiceCounterpartyName,
  type InvoiceMatchCandidate,
  type InvoiceMatchResult,
  type InvoiceMerchantSignal,
  type RecordId,
  TRANSACTION_TYPES,
  type TransactionModel,
} from '@bt/shared/types';
import { LoaderCircleIcon, PaperclipIcon, PencilIcon, PlusIcon, ReceiptTextIcon, SearchIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import InvoiceDetailsForm from './invoice-details-form.vue';
import InvoiceDirectionToggle from './invoice-direction-toggle.vue';
import { buildInvoiceTransactionPatch } from './invoice-transaction-patch';
import { buildInvoiceTransactionPrefill } from './invoice-transaction-prefill';

const HIGH_SCORE = 80;
const MEDIUM_SCORE = 50;
const NEAR_DATE_DAYS = 3;
const MATCH_ERROR_TOAST_ID = 'attach-invoice-match-error';
const LINKED_TOAST_ID = 'attach-invoice-linked';

const ManageTransactionDialogContent = defineAsyncComponent(
  () => import('@/components/dialogs/manage-transaction/dialog-content.vue'),
);

const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { format } = useDateLocale();
const { addNotification, addErrorNotification, addWarningNotification, removeNotification } = useNotificationCenter();
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);
const isExitPage = useIsAiUsageExitPage();
const { isReached } = useAiAllowance();
const isReceiptParsingPaused = computed(() => isReached({ feature: AI_FEATURE.receiptParsing }));
const userStore = useUserStore();
const { txTargetableSourceAccountsActiveFirst } = storeToRefs(useAccountsStore());
const { systemCurrencies } = storeToRefs(useCurrenciesStore());
const { resolveDefaultAccount } = useAccountDropdownPrefs();
const { convert } = useExchangeRates();

const TRIAL_LIMIT = FEATURE_TRIAL_LIMITS[FEATURES.invoice_matching];

const triesLeft = computed(() => userStore.featureTriesLeft({ feature: FEATURES.invoice_matching }));
// Matching uploads the file first, so the attachments gate blocks the flow before the free tries do.
const isAttachmentsGated = computed(() => userStore.isFeatureGated(FEATURES.attachments));
const isTrialSpent = computed(() => triesLeft.value === 0);
// The last free try hits zero while its own result is still open, so only the upload step is walled.
const isPaywalled = computed(() => isAttachmentsGated.value || (isTrialSpent.value && !result.value));

const ACCEPT_ATTRIBUTE = ATTACHMENT_MIME_TYPES.join(',');

const file = ref<File | null>(null);
const transactionType = ref(TRANSACTION_TYPES.expense);
const result = ref<InvoiceMatchResult | null>(null);
const selectedId = ref<RecordId | null>(null);
const pendingTransaction = ref<TransactionModel | null>(null);
const isPickerOpen = ref(false);
const isEditing = ref(false);
const reviewedTransaction = ref<TransactionModel | null>(null);
const createPrefill = ref<TransactionPrefill | null>(null);

const matchMutation = useInvalidatingMutation({
  mutationFn: matchInvoice,
  invalidateKeys: [],
  invalidateOnSettleKeys: [VUE_QUERY_CACHE_KEYS.aiFeaturesStatus],
  errorKey: 'dialogs.attachInvoice.errors.match',
  persistentErrorId: MATCH_ERROR_TOAST_ID,
});

const linkMutation = useInvalidatingMutation({
  mutationFn: async ({ transaction }: { transaction: TransactionModel }) => {
    if (!file.value || !result.value) {
      const error = new Error('No invoice to attach');
      captureException({ error, context: { scope: 'attach-invoice:link' } });
      throw error;
    }

    // Read up front: closing the dialog mid-upload resets `result`.
    const { invoice } = result.value;
    await uploadTransactionAttachment({
      transactionId: transaction.id,
      file: file.value,
    });

    const patch = buildInvoiceTransactionPatch({ invoice, transaction });
    // The file is already attached, so a failed patch must not send the user into a retry that
    // uploads it a second time.
    if (Object.keys(patch).length)
      await editTransaction({ txId: transaction.id, ...patch }).catch((error) => {
        captureException({ error, context: { scope: 'attach-invoice:patch-details' } });
        addWarningNotification(t('dialogs.attachInvoice.errors.detailsNotFilled'));
      });
  },
  invalidateKeys: [VUE_QUERY_CACHE_KEYS.transactionAttachments, [VUE_QUERY_GLOBAL_PREFIXES.transactionChange]],
  errorKey: 'dialogs.attachInvoice.errors.link',
});

const showResult = ({ matched }: { matched: InvoiceMatchResult }) => {
  result.value = matched;
  selectedId.value = matched.candidates[0]?.transaction.id ?? null;
  isEditing.value = false;
};

const rematchMutation = useInvalidatingMutation({
  mutationFn: rematchInvoice,
  invalidateKeys: [],
  errorKey: 'dialogs.attachInvoice.errors.rematch',
});

const searchAgain = async ({ invoice }: { invoice: ExtractedInvoice }) => {
  try {
    const matched = await rematchMutation.mutateAsync({ invoice });
    // Closing the dialog resets the state, so a late result must not repopulate it.
    if (!open.value) return;
    showResult({ matched });
  } catch {
    // The mutation already surfaced the server message.
  }
};

const reset = () => {
  file.value = null;
  transactionType.value = TRANSACTION_TYPES.expense;
  result.value = null;
  selectedId.value = null;
  pendingTransaction.value = null;
  createPrefill.value = null;
  isEditing.value = false;
};

watch(open, (isOpen) => {
  if (isOpen)
    trackAnalyticsEvent({
      event: 'ai_feature_used',
      properties: { feature: 'invoice_matching' },
    });
  else reset();
});

const analyze = async ({ selected }: { selected: File | null }) => {
  if (!selected) return;

  removeNotification(MATCH_ERROR_TOAST_ID);

  // A failed compression still sends the original.
  const [prepared = selected] = await compressImages({
    files: [selected],
  }).catch((error) => {
    captureException({ error, context: { scope: 'attach-invoice:compress' } });
    return [selected];
  });
  // Closing the dialog resets the state, so a late result must not repopulate it.
  if (!open.value) return;
  file.value = prepared;

  const onTrial = triesLeft.value !== null;
  try {
    const matched = await matchMutation.mutateAsync({ file: prepared, transactionType: transactionType.value });
    if (!open.value) return;
    showResult({ matched });
  } catch {
    // The mutation already surfaced the server message.
    file.value = null;
    return;
  }

  // Only refreshes the tries-left counter, so a failure must not undo the match.
  if (onTrial)
    await userStore
      .loadUser()
      .catch((error) => captureException({ error, context: { scope: 'attach-invoice:tries-refresh' } }));
};

const progressText = computed(() => {
  if (matchMutation.isPending.value) return t('dialogs.attachInvoice.analyzing');
  if (linkMutation.isPending.value) return t('dialogs.attachInvoice.attaching');
  return '';
});

const isIncomeInvoice = computed(() => result.value?.invoice.transactionType === TRANSACTION_TYPES.income);

const candidatesCount = computed(() => result.value?.candidates.length ?? 0);

// The empty state explains a zero-match result itself, and the uk plural rules have no zero form.
const dialogDescription = computed(() => {
  if (!result.value) return t('dialogs.attachInvoice.description');
  if (!candidatesCount.value) return '';
  return t('dialogs.attachInvoice.resultsDescription', { count: candidatesCount.value }, candidatesCount.value);
});

const selectedCandidate = computed(() =>
  result.value?.candidates.find((candidate) => candidate.transaction.id === selectedId.value),
);

const invoiceTotal = computed(() =>
  result.value
    ? formatUIAmount(result.value.invoice.totalAmount, {
        currency: result.value.invoice.currencyCode,
      })
    : '',
);

const scoreClass = ({ score }: { score: number }) => {
  if (score >= HIGH_SCORE) return 'text-success-text';
  if (score >= MEDIUM_SCORE) return 'text-warning-text';
  return 'text-muted-foreground';
};

type SignalTone = 'good' | 'warn' | 'neutral';

const SIGNAL_TONE_CLASSES: Record<SignalTone, string> = {
  good: 'bg-success/10 text-success-text',
  warn: 'bg-muted text-warning-text',
  neutral: 'bg-muted text-muted-foreground',
};

// Spelled out so the unused-key sweep can see them.
const merchantLabels: Record<InvoiceMerchantSignal, string> = {
  match: 'dialogs.attachInvoice.signals.merchant.match',
  partial: 'dialogs.attachInvoice.signals.merchant.partial',
  none: 'dialogs.attachInvoice.signals.merchant.none',
  unknown: 'dialogs.attachInvoice.signals.merchant.unknown',
};

const customerLabels: Record<InvoiceMerchantSignal, string> = {
  match: 'dialogs.attachInvoice.signals.customer.match',
  partial: 'dialogs.attachInvoice.signals.customer.partial',
  none: 'dialogs.attachInvoice.signals.customer.none',
  unknown: 'dialogs.attachInvoice.signals.customer.unknown',
};

const signalChips = ({ candidate }: { candidate: InvoiceMatchCandidate }): { label: string; tone: SignalTone }[] => {
  const { signals } = candidate;
  const days = Math.abs(signals.daysFromInvoice);

  const amountLabels = {
    exact: t('dialogs.attachInvoice.signals.amountExact'),
    // `amountDiff` is only set for a close match.
    close:
      signals.amountDiff === null
        ? t('dialogs.attachInvoice.signals.amountUnknown')
        : t('dialogs.attachInvoice.signals.amountClose', {
            diff: formatUIAmount(signals.amountDiff, {
              currency: result.value?.invoice.currencyCode,
            }),
          }),
    converted: t('dialogs.attachInvoice.signals.amountConverted'),
    unknown: t('dialogs.attachInvoice.signals.amountUnknown'),
  };

  let dateLabel = t('dialogs.attachInvoice.signals.sameDay');
  if (signals.daysFromInvoice > 0) dateLabel = t('dialogs.attachInvoice.signals.daysAfter', { count: days }, days);
  if (signals.daysFromInvoice < 0) dateLabel = t('dialogs.attachInvoice.signals.daysBefore', { count: days }, days);

  const merchantTones: Record<typeof signals.merchant, SignalTone> = {
    match: 'good',
    partial: 'warn',
    none: 'neutral',
    unknown: 'neutral',
  };

  return [
    {
      label: amountLabels[signals.amount],
      tone: signals.amount === 'exact' ? 'good' : 'warn',
    },
    { label: dateLabel, tone: days <= NEAR_DATE_DAYS ? 'good' : 'neutral' },
    {
      label: t((isIncomeInvoice.value ? customerLabels : merchantLabels)[signals.merchant]),
      tone: merchantTones[signals.merchant],
    },
  ];
};

// Refetched so the dialog shows the fields the invoice just filled in.
const reviewTransaction = async ({ transaction }: { transaction: TransactionModel }) => {
  try {
    reviewedTransaction.value = await loadTransactionById({ id: transaction.id });
  } catch (error) {
    captureException({ error, context: { scope: 'attach-invoice:open-transaction' } });
    addErrorNotification(t('dialogs.attachInvoice.errors.openTransaction'));
  }
};

const startCreate = () => {
  if (!result.value) return;
  const accounts = txTargetableSourceAccountsActiveFirst.value;
  createPrefill.value = buildInvoiceTransactionPrefill({
    invoice: result.value.invoice,
    accounts,
    defaultAccount: resolveDefaultAccount({ accounts }),
    convert,
    currencies: systemCurrencies.value,
  });
};

const notifyLinked = ({ transaction, text }: { transaction: TransactionModel; text: string }) => {
  open.value = false;
  addNotification({
    id: LINKED_TOAST_ID,
    text,
    type: NotificationType.success,
    persistent: true,
    action: {
      label: t('dialogs.attachInvoice.openTransaction'),
      onClick: () => reviewTransaction({ transaction }),
    },
  });
};

const link = async ({ transaction }: { transaction: TransactionModel }) => {
  try {
    await linkMutation.mutateAsync({ transaction });
    trackAnalyticsEvent({ event: 'invoice_attached', properties: { method: 'link' } });
    notifyLinked({ transaction, text: t('dialogs.attachInvoice.linked') });
  } catch {
    // The mutation already surfaced the server message.
  }
};

const onTransactionCreated = ({
  transaction,
  attachmentsFailed,
}: {
  transaction: TransactionModel | undefined;
  attachmentsFailed: boolean;
}) => {
  // A transfer answers with no row and a failed upload leaves the row bare; either way the dialog
  // stays open for the user to pick the transaction and attach it.
  if (!transaction || attachmentsFailed) {
    return addWarningNotification(t('dialogs.attachInvoice.errors.createdNotAttached'));
  }
  trackAnalyticsEvent({ event: 'invoice_attached', properties: { method: 'create' } });
  notifyLinked({ transaction, text: t('dialogs.attachInvoice.created') });
};

const confirmLink = () => {
  const transaction = pendingTransaction.value;
  pendingTransaction.value = null;
  if (transaction) link({ transaction });
};

const closeTransactionModal = () => {
  reviewedTransaction.value = null;
  createPrefill.value = null;
};
</script>

<template>
  <ResponsiveDialog v-model:open="open" :close-when="isExitPage" dialog-content-class="sm:max-w-xl">
    <template #title>
      {{ candidatesCount ? $t('dialogs.attachInvoice.resultsTitle') : $t('dialogs.attachInvoice.title') }}
    </template>
    <template #description>{{ dialogDescription }}</template>

    <PlanRestricted
      v-if="isPaywalled"
      :feature="isAttachmentsGated ? FEATURES.attachments : FEATURES.invoice_matching"
      :hint="isAttachmentsGated ? undefined : $t('dialogs.attachInvoice.trial.spent')"
    />
    <template v-else>
      <div class="grid gap-4">
        <div
          v-if="progressText"
          class="text-muted-foreground flex min-h-[180px] flex-col items-center justify-center gap-3 text-center text-sm"
          aria-live="polite"
        >
          <LoaderCircleIcon class="text-primary-text size-8 animate-spin" />
          {{ progressText }}
        </div>

        <template v-else-if="!result">
          <InvoiceDirectionToggle v-model="transactionType" />
          <div class="flex justify-end empty:hidden">
            <AiUsageBadge :feature="AI_FEATURE.receiptParsing" />
          </div>
          <FileDropzone
            :model-value="file"
            :accept="ACCEPT_ATTRIBUTE"
            :max-size="ATTACHMENT_MAX_FILE_BYTES"
            height="min-h-[180px]"
            :disabled="isReceiptParsingPaused"
            @update:model-value="(selected: File | null) => analyze({ selected })"
            @error="addErrorNotification"
          >
            <template v-if="isReceiptParsingPaused" #hint>{{ $t('dialogs.attachInvoice.aiPausedHint') }}</template>
          </FileDropzone>
          <Callout v-if="triesLeft !== null">
            {{ $t('dialogs.attachInvoice.trial.left', { count: triesLeft, limit: TRIAL_LIMIT }, triesLeft) }}
          </Callout>
          <p class="text-muted-foreground text-xs">
            {{ $t('dialogs.attachInvoice.privacyNote') }}
          </p>
        </template>

        <InvoiceDetailsForm
          v-else-if="isEditing"
          :invoice="result.invoice"
          :loading="rematchMutation.isPending.value"
          @submit="(invoice: ExtractedInvoice) => searchAgain({ invoice })"
          @cancel="isEditing = false"
        />

        <template v-else>
          <div class="bg-card overflow-hidden rounded-lg border">
            <div class="flex items-center gap-3 px-4 pt-3 pb-2">
              <div class="bg-primary/10 text-primary-text flex size-8 shrink-0 items-center justify-center rounded-md">
                <ReceiptTextIcon class="size-4" />
              </div>
              <div class="grid min-w-0 flex-1">
                <span class="truncate text-sm font-bold">
                  {{ invoiceCounterpartyName({ invoice: result.invoice }) ?? result.invoice.vendorName }}
                </span>
                <span class="text-muted-foreground truncate text-xs">{{ file?.name }}</span>
              </div>
              <Button
                type="button"
                variant="ghost-primary"
                size="sm"
                class="shrink-0"
                :disabled="linkMutation.isPending.value"
                @click="isEditing = true"
              >
                <PencilIcon class="size-3.5" />
                {{ $t('dialogs.attachInvoice.fixDetails') }}
              </Button>
            </div>
            <div class="border-border mx-4 border-t border-dashed" />
            <dl class="grid grid-cols-3 gap-3 px-4 pt-2 pb-3 text-sm tabular-nums">
              <div class="grid min-w-0">
                <dt class="text-muted-foreground text-xs">
                  {{ $t('dialogs.attachInvoice.invoice.number') }}
                </dt>
                <dd class="truncate font-medium">
                  {{ result.invoice.invoiceNumber ?? '—' }}
                </dd>
              </div>
              <div class="grid">
                <dt class="text-muted-foreground text-xs">
                  {{ $t('dialogs.attachInvoice.invoice.issued') }}
                </dt>
                <dd class="font-medium">
                  {{ format(parseISO(result.invoice.issueDate), 'd MMM yyyy') }}
                </dd>
              </div>
              <div class="grid text-right">
                <dt class="text-muted-foreground text-xs">
                  {{ $t('dialogs.attachInvoice.invoice.total') }}
                </dt>
                <dd class="font-bold">{{ invoiceTotal }}</dd>
              </div>
            </dl>
          </div>

          <div
            v-if="result.candidates.length"
            role="radiogroup"
            :aria-label="$t('dialogs.attachInvoice.resultsTitle')"
            class="grid gap-2"
          >
            <div
              v-for="(candidate, index) in result.candidates"
              :key="candidate.transaction.id"
              role="radio"
              :aria-checked="candidate.transaction.id === selectedId"
              tabindex="0"
              :class="
                cn(
                  'focus-visible:ring-ring ring-offset-background grid gap-2 rounded-lg border p-2 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden',
                  candidate.transaction.id === selectedId
                    ? 'border-primary bg-primary/10'
                    : 'hover:bg-muted/50 cursor-pointer',
                  linkMutation.isPending.value && 'pointer-events-none opacity-60',
                )
              "
              @click="selectedId = candidate.transaction.id"
              @keydown.enter.prevent="selectedId = candidate.transaction.id"
              @keydown.space.prevent="selectedId = candidate.transaction.id"
            >
              <TransactionRecord :tx="candidate.transaction" class="pointer-events-none" />

              <div class="flex flex-wrap items-center gap-1.5 px-2 text-xs font-medium">
                <span
                  v-for="chip in signalChips({ candidate })"
                  :key="chip.label"
                  :class="cn('rounded-md px-1.5 py-0.5', SIGNAL_TONE_CLASSES[chip.tone])"
                >
                  {{ chip.label }}
                </span>
                <span
                  v-if="candidate.transaction.hasAttachments"
                  class="text-muted-foreground inline-flex items-center gap-1"
                >
                  <PaperclipIcon class="size-3" />
                  {{ $t('dialogs.attachInvoice.alreadyHasFile') }}
                </span>
                <span :class="cn('ml-auto font-bold tabular-nums', scoreClass({ score: candidate.score }))">
                  {{
                    index === 0 && candidate.score >= HIGH_SCORE
                      ? $t('dialogs.attachInvoice.bestMatch', {
                          score: candidate.score,
                        })
                      : `${candidate.score}%`
                  }}
                </span>
              </div>
            </div>
          </div>

          <div v-else class="flex flex-col items-center gap-2 py-4 text-center">
            <div class="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-lg">
              <SearchIcon class="size-5" />
            </div>
            <p class="font-bold">
              {{ $t('dialogs.attachInvoice.empty.title') }}
            </p>
            <p class="text-muted-foreground max-w-sm text-sm">
              {{
                $t('dialogs.attachInvoice.empty.description', {
                  total: invoiceTotal,
                })
              }}
            </p>
            <div class="mt-2 flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                variant="soft-primary"
                :disabled="linkMutation.isPending.value"
                @click="isPickerOpen = true"
              >
                <SearchIcon class="size-4" />
                {{ $t('dialogs.attachInvoice.searchManually') }}
              </Button>
              <Button type="button" :disabled="linkMutation.isPending.value" @click="startCreate">
                <PlusIcon class="size-4" />
                {{ $t('dialogs.attachInvoice.createTransaction') }}
              </Button>
            </div>
          </div>
        </template>
      </div>
    </template>

    <template v-if="result?.candidates.length && !isEditing && !progressText" #footer>
      <Button
        type="button"
        variant="ghost-primary"
        class="sm:mr-auto"
        :disabled="linkMutation.isPending.value"
        @click="isPickerOpen = true"
      >
        <SearchIcon class="size-4" />
        {{ $t('dialogs.attachInvoice.searchManually') }}
      </Button>
      <Button type="button" variant="ghost-primary" :disabled="linkMutation.isPending.value" @click="startCreate">
        <PlusIcon class="size-4" />
        {{ $t('dialogs.attachInvoice.createTransaction') }}
      </Button>
      <Button
        type="button"
        :disabled="!selectedCandidate || linkMutation.isPending.value"
        :loading="linkMutation.isPending.value"
        @click="pendingTransaction = selectedCandidate?.transaction ?? null"
      >
        {{ $t('dialogs.attachInvoice.link') }}
      </Button>
    </template>
  </ResponsiveDialog>

  <PickTransactionDialog
    v-model:open="isPickerOpen"
    :transaction-type="result?.invoice.transactionType ?? transactionType"
    @select="pendingTransaction = $event"
  />

  <ResponsiveAlertDialog
    :open="!!pendingTransaction"
    :confirm-label="$t('dialogs.attachInvoice.link')"
    @update:open="(value: boolean) => !value && (pendingTransaction = null)"
    @confirm="confirmLink"
  >
    <template #title>{{ $t('dialogs.attachInvoice.confirm.title') }}</template>
    <template #description>
      <i18n-t v-if="pendingTransaction" keypath="dialogs.attachInvoice.confirm.description" tag="span">
        <template #filename>
          <span class="text-foreground font-semibold break-all">{{ file?.name }}</span>
        </template>
        <template #amount>
          <span class="text-foreground font-semibold">
            {{
              formatUIAmount(pendingTransaction.amount, {
                currency: pendingTransaction.currencyCode,
              })
            }}
          </span>
        </template>
        <template #date>
          <span class="text-foreground font-semibold">
            {{ format(new Date(pendingTransaction.time), 'd MMM yyyy') }}
          </span>
        </template>
      </i18n-t>
    </template>
  </ResponsiveAlertDialog>

  <TransactionDetailsModal
    :open="!!reviewedTransaction || !!createPrefill"
    :mobile="isMobile"
    @update:open="(value: boolean) => !value && closeTransactionModal()"
  >
    <ManageTransactionDialogContent
      v-if="reviewedTransaction"
      :transaction="reviewedTransaction"
      @close-modal="closeTransactionModal"
    />
    <ManageTransactionDialogContent
      v-else-if="createPrefill"
      :prefill="createPrefill"
      :initial-attachments="file ? [file] : []"
      @created="onTransactionCreated"
      @close-modal="closeTransactionModal"
    />
  </TransactionDetailsModal>
</template>

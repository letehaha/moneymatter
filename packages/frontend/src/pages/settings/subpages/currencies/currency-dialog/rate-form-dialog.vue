<template>
  <ResponsiveDialog v-model:open="open" dialog-content-class="max-w-lg" :dismissible="!isBusy">
    <template #title>
      {{ rate ? $t('settings.currencies.dialog.form.editTitle') : $t('settings.currencies.dialog.form.addTitle') }}
    </template>
    <template #description>{{ description }}</template>

    <div class="@container/rate-form grid gap-4" :data-testid="rate ? 'edit-dated-rate' : 'add-dated-rate'">
      <div class="grid gap-1.5">
        <div class="grid gap-3 @sm/rate-form:grid-cols-2">
          <div class="flex min-w-0 items-end gap-2">
            <InputField
              v-model="form.baseRate"
              type="number"
              only-positive
              class="min-w-0 flex-1"
              :label="`1 ${code} =`"
              :placeholder="$t('settings.currencies.exchangeRate.ratePlaceholder')"
              :disabled="isInputDisabled"
              data-testid="manual-rate-base"
              @focus="editing = 'base'"
            />
            <span class="text-muted-foreground flex h-10 shrink-0 items-center text-sm">{{ quoteCode }}</span>
          </div>
          <div class="flex min-w-0 items-end gap-2">
            <InputField
              v-model="form.quoteRate"
              type="number"
              only-positive
              class="min-w-0 flex-1"
              :label="`1 ${quoteCode} =`"
              :placeholder="$t('settings.currencies.exchangeRate.ratePlaceholder')"
              :disabled="isInputDisabled"
              data-testid="manual-rate-quote"
              @focus="editing = 'quote'"
            />
            <span class="text-muted-foreground flex h-10 shrink-0 items-center text-sm">{{ code }}</span>
          </div>
        </div>
        <span v-if="canEdit" class="text-muted-foreground text-xs">
          {{ $t('settings.currencies.dialog.form.typeEither') }}
        </span>
      </div>

      <div v-if="!rate" class="grid gap-1.5">
        <DateField
          v-model="effectiveDate"
          mode="date"
          :label="$t('settings.currencies.dialog.form.dateLabel')"
          :disabled="isBusy"
          :calendar-options="{ maxDate: new Date() }"
          data-testid="manual-rate-effective-date"
        />
        <span v-if="isPickedToday" class="text-muted-foreground text-xs" data-testid="rate-form-today">
          {{ $t('settings.currencies.dialog.form.today') }}
        </span>
      </div>

      <p v-if="!canEdit" class="text-muted-foreground text-sm" data-testid="rate-history-connect-note">
        {{ $t('settings.currencies.rateSource.history.connectToEdit', { quote: quoteCode }) }}
      </p>
      <Callout v-else-if="note" :variant="note.variant" data-testid="rate-form-note">{{ note.text }}</Callout>
    </div>

    <template #footer>
      <div class="flex w-full flex-wrap items-start justify-between gap-3">
        <div v-if="rate" class="grid justify-items-start gap-1">
          <Button
            variant="ghost-destructive"
            :disabled="isBusy || !isFetched || isLastRate"
            data-testid="rate-form-remove"
            @click="isRemoveOpen = true"
          >
            <Trash2Icon class="size-4" />
            {{ $t('settings.currencies.dialog.form.remove') }}
          </Button>
          <span v-if="isLastRate" class="text-muted-foreground text-xs" data-testid="rate-form-last-rate">
            {{ $t('settings.currencies.dialog.form.lastRate') }}
          </span>
        </div>
        <div class="ml-auto flex flex-wrap justify-end gap-2">
          <Button variant="outline" :disabled="isBusy" @click="open = false">
            {{ $t('common.actions.cancel') }}
          </Button>
          <Button
            v-if="canEdit"
            :disabled="!canSubmit"
            :loading="isSaving"
            data-testid="manual-rate-save"
            @click="save"
          >
            {{
              writePreview?.kind === 'replace' && !rate
                ? $t('settings.currencies.dialog.form.replace')
                : $t('settings.currencies.dialog.form.save')
            }}
          </Button>
        </div>
      </div>
    </template>
  </ResponsiveDialog>

  <RemoveRateDialog
    v-if="rate"
    v-model:open="isRemoveOpen"
    v-model:removing="isRemoving"
    :currency="currency"
    :rate="rate"
    @removed="open = false"
  />
</template>

<script setup lang="ts">
import { editUserCurrenciesExchangeRates } from '@/api/currencies';
import { utcDayKey } from '@/common/utils/date';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { useCurrenciesStore } from '@/stores';
import type { CurrencyRateHistoryItem, RefBalanceRemeasureResult } from '@bt/shared/types';
import { Trash2Icon } from '@lucide/vue';
import { format, isToday } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { calculateRatio } from '../currency-row/calculate-ratio';
import { formatCustomRate } from '../rate-precision';
import { useRateHistory } from '../rate-source/use-rate-history';
import type { CurrencyWithExchangeRate } from '../types';
import { useRefreshAfterCurrencyChange } from '../use-refresh-after-currency-change';
import RemoveRateDialog from './remove-rate-dialog.vue';
import {
  type DayRange,
  formatDay,
  formatDayRange,
  previewRateRemoval,
  previewRateWrite,
  type RateWritePreview,
} from './rate-timeline';
import { useRateNotifications } from './use-rate-notifications';
import { useRatePair } from './use-rate-pair';

const API_DATE_FORMAT = 'yyyy-MM-dd';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  /** A stored rate to edit; without it the dialog adds a rate. */
  rate?: CurrencyRateHistoryItem;
}>();

const open = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { notifyRateSaved, notifyRateFailed } = useRateNotifications();
const refreshAfterChange = useRefreshAfterCurrencyChange();
const { currencies } = storeToRefs(useCurrenciesStore());

const code = computed(() => props.currency.currencyCode);
const quoteCode = computed(() => props.rate?.quoteCode ?? props.currency.quoteCode);

const { rates, totalCount, isFetched, isLoadingError, hasNextPage } = useRateHistory({
  code: props.currency.currencyCode,
});

// A dated write needs both sides of the pair connected, so a rate quoted in a currency the user
// does not hold can be removed but not edited.
const canEdit = computed(
  () => !props.rate || currencies.value.some((item) => item.currencyCode === props.rate!.quoteCode),
);

const savedRates = computed(() =>
  props.rate
    ? {
        baseRate: props.rate.rate,
        quoteRate: calculateRatio({ value: props.rate.rate, isCustom: props.currency.isCustomCurrency }),
      }
    : { baseRate: props.currency.rate, quoteRate: props.currency.quoteRate },
);

const { form, editing, isRateChanged, hasRateValue, resetPair } = useRatePair({
  saved: () => savedRates.value,
  isCustom: () => props.currency.isCustomCurrency,
});
const effectiveDate = ref(new Date());
const isSaving = ref(false);
const isRemoving = ref(false);
const isBusy = computed(() => isSaving.value || isRemoving.value);
const isRemoveOpen = ref(false);

watch(
  [open, () => props.rate?.effectiveDate],
  ([isOpen]) => {
    if (!isOpen) return;
    resetPair();
    effectiveDate.value = new Date();
  },
  { immediate: true },
);

const isPickedToday = computed(() => isToday(effectiveDate.value));
// The API dates rates by the UTC day, which the local "today" misses near midnight, so today is
// previewed as the UTC day and left out of the request.
const day = computed(() => {
  if (props.rate) return props.rate.effectiveDate;
  return isPickedToday.value ? utcDayKey({ date: new Date() }) : format(effectiveDate.value, API_DATE_FORMAT);
});
const datedFields = computed(() => (props.rate || !isPickedToday.value ? { effectiveDate: day.value } : {}));

const writePreview = computed<RateWritePreview | null>(() =>
  isFetched.value
    ? previewRateWrite({
        day: day.value,
        today: utcDayKey({ date: new Date() }),
        rates: rates.value,
        hasOlder: hasNextPage.value,
        isLoadFailed: isLoadingError.value,
      })
    : null,
);

const isLastRate = computed(
  () =>
    !!props.rate &&
    isFetched.value &&
    previewRateRemoval({
      rate: props.rate,
      rates: rates.value,
      hasOlder: hasNextPage.value,
      totalCount: totalCount.value,
      isLoadFailed: isLoadingError.value,
    }).kind === 'lastRate',
);

const recalcText = ({ range }: { range: DayRange }) => {
  const { from, to } = range;
  if (from && to)
    return t('settings.currencies.dialog.form.recalcRange', { code: code.value, range: formatDayRange({ from, to }) });
  if (from)
    return t('settings.currencies.dialog.form.recalcFrom', { code: code.value, date: formatDay({ day: from }) });
  if (to) return t('settings.currencies.dialog.form.recalcUntil', { code: code.value, date: formatDay({ day: to }) });
  return t('settings.currencies.dialog.form.recalcAll', { code: code.value });
};

const description = computed(() => {
  if (!props.rate) return t('settings.currencies.dialog.form.addDescription', { code: code.value });
  if (writePreview.value?.kind !== 'replace') return '';

  const { from, to } = writePreview.value.recalculated;
  const start = props.rate.effectiveDate;
  if (from && to) return t('settings.currencies.dialog.form.usedFor', { range: formatDayRange({ from, to }) });
  if (to) return t('settings.currencies.dialog.form.usedForAndBefore', { range: formatDayRange({ from: start, to }) });
  if (!from) return t('settings.currencies.dialog.form.usedEveryDay');
  return t('settings.currencies.dialog.form.usedFrom', { date: formatDay({ day: start }) });
});

const note = computed<{ variant: 'warning' | 'info'; text: string } | null>(() => {
  const preview = writePreview.value;
  if (!preview) return null;

  const amountsKept = t('settings.currencies.dialog.form.amountsKept', { code: code.value });

  if (props.rate) {
    if (preview.kind !== 'replace') return null;
    const moveHint = t('settings.currencies.dialog.form.moveHint');
    return { variant: 'info', text: [recalcText({ range: preview.recalculated }), amountsKept, moveHint].join(' ') };
  }

  switch (preview.kind) {
    case 'replace': {
      const replaceNote = t('settings.currencies.dialog.form.replaceNote', {
        date: formatDay({ day: preview.existing.effectiveDate }),
        rate: formatCustomRate({ value: preview.existing.rate }),
        quote: preview.existing.quoteCode,
      });
      return {
        variant: 'warning',
        text: [replaceNote, recalcText({ range: preview.recalculated }), amountsKept].join(' '),
      };
    }
    case 'recalculates':
      return { variant: 'info', text: `${recalcText({ range: preview.recalculated })} ${amountsKept}` };
    case 'noChange':
      return { variant: 'info', text: t('settings.currencies.dialog.form.noChange') };
    default:
      return { variant: 'info', text: t('settings.currencies.dialog.form.unknown', { code: code.value }) };
  }
});

const isInputDisabled = computed(() => isBusy.value || !canEdit.value);

const isDateChanged = computed(() => !props.rate && !isPickedToday.value);
// A null preview means the history is still loading; saving then could skip the "Replace" warning.
const canSubmit = computed(
  () =>
    canEdit.value &&
    !isBusy.value &&
    writePreview.value !== null &&
    hasRateValue.value &&
    (isRateChanged.value || isDateChanged.value),
);

const save = async () => {
  if (!canSubmit.value) return;

  isSaving.value = true;
  let remeasure: RefBalanceRemeasureResult;
  try {
    ({ remeasure } = await editUserCurrenciesExchangeRates([
      { baseCode: code.value, quoteCode: quoteCode.value, rate: Number(form.baseRate), ...datedFields.value },
      { baseCode: quoteCode.value, quoteCode: code.value, rate: Number(form.quoteRate), ...datedFields.value },
    ]));
  } catch (error) {
    notifyRateFailed({
      error,
      fallback: t('settings.currencies.exchangeRate.errors.updateFailed'),
      flow: 'saveCustomRate',
    });
    return;
  } finally {
    isSaving.value = false;
  }

  notifyRateSaved({ message: t('settings.currencies.exchangeRate.successfullyUpdated'), remeasure });
  open.value = false;
  await refreshAfterChange();
};
</script>

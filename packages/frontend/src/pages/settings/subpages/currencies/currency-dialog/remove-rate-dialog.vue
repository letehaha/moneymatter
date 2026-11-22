<template>
  <ResponsiveAlertDialog
    v-model:open="open"
    :confirm-label="$t('settings.currencies.dialog.remove.confirm')"
    confirm-variant="destructive"
    :confirm-disabled="isRemoving || !preview || preview.kind === 'lastRate'"
    @confirm="removeRate"
  >
    <template #title>
      {{ $t('settings.currencies.dialog.remove.title', { date: formatDay({ day: rate.effectiveDate }) }) }}
    </template>
    <template #description>
      <p data-testid="remove-rate-description">{{ description }}</p>
    </template>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import { deleteCustomRate } from '@/api/currencies';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import type { CurrencyRateHistoryItem, RefBalanceRemeasureResult } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { formatCustomRate } from '../rate-precision';
import { useRateHistory } from '../rate-source/use-rate-history';
import type { CurrencyWithExchangeRate } from '../types';
import { useRefreshAfterCurrencyChange } from '../use-refresh-after-currency-change';
import { formatDay, formatRateDays, previewRateRemoval } from './rate-timeline';
import { useRateNotifications } from './use-rate-notifications';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  rate: CurrencyRateHistoryItem;
}>();

const emit = defineEmits<{ removed: [] }>();

const open = defineModel<boolean>('open', { default: false });
// Bound by the rate form so it locks its own inputs while the removal runs.
const isRemoving = defineModel<boolean>('removing', { default: false });

const { t } = useI18n();
const { notifyRateSaved, notifyRateFailed } = useRateNotifications();
const refreshAfterChange = useRefreshAfterCurrencyChange();

const code = computed(() => props.currency.currencyCode);
const { rates, totalCount, isFetched, isLoadingError, hasNextPage } = useRateHistory({
  code: props.currency.currencyCode,
});

const preview = computed(() =>
  isFetched.value
    ? previewRateRemoval({
        rate: props.rate,
        rates: rates.value,
        hasOlder: hasNextPage.value,
        totalCount: totalCount.value,
        isLoadFailed: isLoadingError.value,
      })
    : null,
);

const description = computed(() => {
  const recalc = t('settings.currencies.dialog.remove.recalc', { code: code.value });
  const value = preview.value;
  if (!value) return recalc;
  if (value.kind === 'lastRate') return t('settings.currencies.dialog.form.lastRate');

  if (value.kind === 'unknown') {
    const unknown = value.affected
      ? t('settings.currencies.dialog.remove.unknown', {
          range: formatRateDays({ from: props.rate.effectiveDate, to: value.affected.to, t }),
        })
      : t('settings.currencies.dialog.remove.unknownDays');
    return `${unknown} ${recalc}`;
  }

  const key = value.affected.from === null ? 'takenOverWithEarlier' : 'takenOver';
  const takenOver = t(`settings.currencies.dialog.remove.${key}`, {
    range: formatRateDays({ from: props.rate.effectiveDate, to: value.affected.to, t }),
    date: formatDay({ day: value.rate.effectiveDate }),
    code: code.value,
    rate: formatCustomRate({ value: value.rate.rate }),
    quote: value.rate.quoteCode,
  });
  return `${takenOver} ${recalc}`;
});

const removeRate = async () => {
  const { quoteCode, effectiveDate } = props.rate;

  isRemoving.value = true;
  let remeasure: RefBalanceRemeasureResult;
  try {
    ({ remeasure } = await deleteCustomRate([
      { baseCode: code.value, quoteCode, effectiveDate },
      { baseCode: quoteCode, quoteCode: code.value, effectiveDate },
    ]));
  } catch (error) {
    notifyRateFailed({
      error,
      fallback: t('settings.currencies.rateSource.manual.errors.removeFailed'),
      flow: 'removeCustomRate',
    });
    return;
  } finally {
    isRemoving.value = false;
  }

  notifyRateSaved({ message: t('settings.currencies.rateSource.manual.successfullyRemoved'), remeasure });
  open.value = false;
  emit('removed');
  await refreshAfterChange();
};
</script>

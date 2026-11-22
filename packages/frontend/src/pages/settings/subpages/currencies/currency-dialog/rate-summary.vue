<template>
  <section class="border-border bg-muted/30 grid gap-1.5 rounded-xl border px-4 py-3.5" data-testid="rate-summary">
    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {{ $t('settings.currencies.dialog.summary.current') }}
      </span>
      <StatusBadge v-if="chip" :variant="chip.variant" data-testid="rate-summary-chip">{{ chip.text }}</StatusBadge>
    </div>

    <i18n-t
      keypath="settings.currencies.dialog.row.rate"
      tag="p"
      class="text-muted-foreground text-2xl font-medium break-words tabular-nums"
      data-testid="rate-summary-main"
    >
      <template #code>{{ lead.code }}</template>
      <template #rate>
        <span class="text-foreground font-bold">{{ formatRate({ value: lead.rate }) }}</span>
      </template>
      <template #quote>{{ lead.quote }}</template>
    </i18n-t>

    <div class="flex flex-wrap items-end justify-between gap-3">
      <span class="text-muted-foreground text-sm break-words tabular-nums" data-testid="rate-summary-inverse">
        {{
          $t('settings.currencies.dialog.row.rate', {
            code: lead.quote,
            rate: formatRate({ value: lead.inverse }),
            quote: lead.code,
          })
        }}
      </span>
      <Button v-if="isManualCustom" size="sm" data-testid="rate-summary-update" @click="isAddOpen = true">
        {{ $t('settings.currencies.dialog.summary.update') }}
      </Button>
    </div>

    <RateFormDialog v-if="isManualCustom" v-model:open="isAddOpen" :currency="currency" />
  </section>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { StatusBadge } from '@/components/lib/ui/status-badge';
import { toLocalNumber } from '@/js/helpers/formatters';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { rateDisplayOptions } from '../rate-precision';
import { useRateHistory } from '../rate-source/use-rate-history';
import type { CurrencyWithExchangeRate } from '../types';
import RateFormDialog from './rate-form-dialog.vue';
import { formatDay } from './rate-timeline';
import { getPegTarget } from './source-summary';

const RATE_DISPLAY_DECIMALS = 6;

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
}>();

const { t } = useI18n();

const isAddOpen = ref(false);

const code = computed(() => props.currency.currencyCode);

// Keep this lookup inside the dialog body: the shell stays mounted after close and would refetch a deleted currency.
const rateHistory = props.currency.isCustomCurrency ? useRateHistory({ code: props.currency.currencyCode }) : null;
const inForceDay = computed(() => rateHistory?.rates.value.find((rate) => rate.isInForce)?.effectiveDate ?? null);
const isManualCustom = computed(() => props.currency.isCustomCurrency && props.currency.rateSource === 'manual');

const formatRate = ({ value }: { value: number }) =>
  Number.isFinite(value)
    ? toLocalNumber(
        value,
        rateDisplayOptions({ isCustom: props.currency.isCustomCurrency, isoDecimals: RATE_DISPLAY_DECIMALS }),
      )
    : '—';

// `rate` is what 1 {code} is worth in `quoteCode`. An ISO currency reads from the base currency's side.
const lead = computed(() =>
  props.currency.isCustomCurrency
    ? {
        code: code.value,
        quote: props.currency.quoteCode,
        rate: props.currency.rate,
        inverse: props.currency.quoteRate,
      }
    : {
        code: props.currency.quoteCode,
        quote: code.value,
        rate: props.currency.quoteRate,
        inverse: props.currency.rate,
      },
);

const chip = computed<{ variant: 'success' | 'info'; text: string } | null>(() => {
  const base = 'settings.currencies.dialog.summary';

  if (!props.currency.isCustomCurrency) {
    return props.currency.custom
      ? { variant: 'info', text: t(`${base}.yourRate`) }
      : { variant: 'success', text: t(`${base}.live`) };
  }

  if (props.currency.rateSource === 'peg') {
    return { variant: 'info', text: t(`${base}.follows`, { code: getPegTarget({ currency: props.currency }) }) };
  }

  if (!inForceDay.value) return null;
  const key = props.currency.rateSource === 'manual' ? 'since' : 'updated';
  return { variant: 'success', text: t(`${base}.${key}`, { date: formatDay({ day: inForceDay.value }) }) };
});
</script>

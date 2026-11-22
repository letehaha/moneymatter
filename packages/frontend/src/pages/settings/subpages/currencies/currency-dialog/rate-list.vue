<template>
  <ul class="border-border divide-border divide-y rounded-xl border" data-testid="rate-list">
    <li
      v-for="(rate, index) in rates"
      :key="`${rate.quoteCode}-${rate.effectiveDate}`"
      class="flex items-center gap-2 py-2.5 pr-2 pl-3.5"
      data-testid="rate-history-row"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-sm font-semibold" data-testid="rate-history-day">
            {{ formatRateDays({ from: rate.effectiveDate, to: rowEnd({ index }), t }) }}
          </span>
          <StatusBadge v-if="rate.isInForce" variant="success" data-testid="rate-history-in-force">
            {{ $t('settings.currencies.dialog.row.current') }}
          </StatusBadge>
          <StatusBadge v-if="rate.source !== currency.rateSource" variant="neutral" data-testid="rate-history-source">
            {{ $t(`settings.currencies.dialog.row.source.${rate.source}`) }}
          </StatusBadge>
        </div>
        <i18n-t
          keypath="settings.currencies.dialog.row.rate"
          tag="span"
          class="text-muted-foreground text-sm break-words tabular-nums"
          data-testid="rate-history-rate"
        >
          <template #code>{{ currency.currencyCode }}</template>
          <template #rate>
            <span class="text-foreground font-semibold">{{ formatCustomRate({ value: rate.rate }) }}</span>
          </template>
          <template #quote>
            <span class="text-foreground font-semibold">{{ rate.quoteCode }}</span>
          </template>
        </i18n-t>
      </div>

      <DesktopOnlyTooltip v-if="currency.rateSource === 'manual'" :content="editLabel({ rate })">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="shrink-0"
          :aria-label="editLabel({ rate })"
          data-testid="rate-history-edit"
          @click="openEdit({ rate })"
        >
          <PencilIcon class="size-4" />
        </Button>
      </DesktopOnlyTooltip>
    </li>
  </ul>

  <RateFormDialog v-if="editingRate" v-model:open="isEditOpen" :currency="currency" :rate="editingRate" />
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { StatusBadge } from '@/components/lib/ui/status-badge';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import type { CurrencyRateHistoryItem } from '@bt/shared/types';
import { PencilIcon } from '@lucide/vue';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { formatCustomRate } from '../rate-precision';
import type { CurrencyWithExchangeRate } from '../types';
import RateFormDialog from './rate-form-dialog.vue';
import { dayBefore, formatDay, formatRateDays } from './rate-timeline';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  /** Consecutive rates, latest first: each row ends the day before the row above it starts. */
  rates: CurrencyRateHistoryItem[];
}>();

const { t } = useI18n();

const rowEnd = ({ index }: { index: number }) =>
  index === 0 ? null : dayBefore({ day: props.rates[index - 1]!.effectiveDate });

const editLabel = ({ rate }: { rate: CurrencyRateHistoryItem }) =>
  t('settings.currencies.dialog.row.edit', { date: formatDay({ day: rate.effectiveDate }) });

// The dialog stays mounted after closing, with the row it last showed, so it can animate out.
const editingRate = ref<CurrencyRateHistoryItem | null>(null);
const isEditOpen = ref(false);

const openEdit = ({ rate }: { rate: CurrencyRateHistoryItem }) => {
  editingRate.value = rate;
  isEditOpen.value = true;
};
</script>

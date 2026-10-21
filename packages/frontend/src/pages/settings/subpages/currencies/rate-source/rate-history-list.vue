<template>
  <section class="grid gap-3" data-testid="rate-history">
    <h3 class="text-sm font-semibold">{{ $t('settings.currencies.rateSource.history.title') }}</h3>

    <Callout v-if="isLoadingError" variant="destructive" data-testid="rate-history-error">
      <span class="flex flex-wrap items-center justify-between gap-2">
        {{ $t('settings.currencies.rateSource.history.loadFailed') }}
        <Button type="button" variant="outline" size="sm" data-testid="rate-history-retry" @click="refetch()">
          {{ $t('settings.currencies.rateSource.history.retryButton') }}
        </Button>
      </span>
    </Callout>

    <div v-else-if="!isFetched" class="grid gap-2" data-testid="rate-history-loading" aria-hidden="true">
      <div v-for="index in SKELETON_ROWS" :key="index" class="bg-muted/50 h-12 animate-pulse rounded-md" />
    </div>

    <div
      v-else-if="!rates.length"
      class="text-muted-foreground flex flex-col items-center gap-1 py-4 text-center"
      data-testid="rate-history-empty"
    >
      <HistoryIcon class="size-5" aria-hidden="true" />
      <p class="text-foreground text-sm font-medium">
        {{ $t('settings.currencies.rateSource.history.emptyTitle') }}
      </p>
      <p class="max-w-prose text-xs leading-5">
        {{
          isPegged
            ? $t('settings.currencies.rateSource.history.emptyPegged', { code })
            : $t('settings.currencies.rateSource.history.emptyDescription')
        }}
      </p>
    </div>

    <template v-else>
      <p v-if="note" class="text-muted-foreground text-xs leading-5" data-testid="rate-history-note">{{ note }}</p>

      <ul class="grid gap-2">
        <li
          v-for="rate in rates"
          :key="`${rate.quoteCode}-${rate.effectiveDate}`"
          class="border-border/60 bg-background flex items-center gap-3 rounded-md border px-3 py-2"
          :class="{ 'opacity-60': isPegged }"
          data-testid="rate-history-row"
        >
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="text-sm font-semibold" data-testid="rate-history-day">
                {{ $t('settings.currencies.rateSource.history.startsOn', { date: formatDay(rate.effectiveDate) }) }}
              </span>
              <span
                class="border-border text-muted-foreground inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                data-testid="rate-history-source"
              >
                {{ $t(`settings.currencies.rateSource.sources.${rate.source}`) }}
              </span>
              <StatusBadge v-if="rate.isInForce" variant="success" data-testid="rate-history-in-force">
                {{ $t('settings.currencies.rateSource.history.inForce') }}
              </StatusBadge>
            </div>
            <div class="mt-0.5 text-sm tabular-nums" data-testid="rate-history-rate">
              {{ `1 ${code} = ${formatRate(rate.rate)} ${rate.quoteCode}` }}
            </div>
            <p
              v-if="isEditable && !isQuoteHeld({ quoteCode: rate.quoteCode })"
              class="text-muted-foreground mt-1 text-xs leading-5"
              data-testid="rate-history-connect-note"
            >
              {{ $t('settings.currencies.rateSource.history.connectToEdit', { quote: rate.quoteCode }) }}
            </p>
          </div>

          <div v-if="isEditable" class="flex shrink-0 items-center gap-1">
            <DesktopOnlyTooltip
              v-if="isQuoteHeld({ quoteCode: rate.quoteCode })"
              :content="$t('settings.currencies.rateSource.history.editButton')"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                :disabled="isFormDisabled"
                :aria-label="$t('settings.currencies.rateSource.history.editButton')"
                data-testid="rate-history-edit"
                @click="openEdit({ rate })"
              >
                <PencilIcon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
            <DesktopOnlyTooltip :content="$t('settings.currencies.rateSource.history.removeButton')">
              <Button
                type="button"
                variant="ghost-destructive"
                size="icon-sm"
                :disabled="isFormDisabled"
                :aria-label="$t('settings.currencies.rateSource.history.removeButton')"
                data-testid="rate-history-remove"
                @click="openRemove({ rate })"
              >
                <Trash2Icon class="size-4" />
              </Button>
            </DesktopOnlyTooltip>
          </div>
        </li>
      </ul>

      <div v-if="hasNextPage" class="flex justify-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :loading="isFetchingNextPage"
          :disabled="isFetchingNextPage"
          data-testid="rate-history-show-more"
          @click="fetchNextPage()"
        >
          {{ $t('settings.currencies.rateSource.history.showMore') }}
        </Button>
      </div>
    </template>

    <EditDatedRate
      v-if="editingRate"
      v-model:open="isEditOpen"
      :code="code"
      :quote-code="editingRate.quoteCode"
      :effective-date="editingRate.effectiveDate"
      :rate="editingRate.rate"
      :is-form-disabled="isFormDisabled"
      @submit="handleChanged"
      @trigger-disabled="emit('trigger-disabled', $event)"
    />
    <RemoveDatedRate
      v-if="removingRate"
      v-model:open="isRemoveOpen"
      :code="code"
      :quote-code="removingRate.quoteCode"
      :effective-date="removingRate.effectiveDate"
      :is-form-disabled="isFormDisabled"
      @submit="handleChanged"
      @trigger-disabled="emit('trigger-disabled', $event)"
    />
  </section>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { StatusBadge } from '@/components/lib/ui/status-badge';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useCurrenciesStore } from '@/stores';
import type { CurrencyRateHistoryItem } from '@bt/shared/types';
import { HistoryIcon, PencilIcon, Trash2Icon } from '@lucide/vue';
import { format, parseISO } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import RemoveDatedRate from '../currency-row/remove-dated-rate.vue';
import EditDatedRate from './edit-dated-rate.vue';
import type { EditableRateSource } from './rate-source-draft';
import { useInvalidateRateHistory, useRateHistory } from './use-rate-history';

const SKELETON_ROWS = 3;
// A custom currency can be worth a tiny fraction of its quote, so its rate shows more digits.
const RATE_MAX_FRACTION_DIGITS = 12;

const props = defineProps<{
  code: string;
  /** The source saved on the currency, not the one picked in the editor: it decides who owns the rows. */
  savedSource: EditableRateSource;
  isFormDisabled: boolean;
}>();

const emit = defineEmits<{
  /** A rate was edited or removed; the amounts valued by it need a refresh. */
  changed: [];
  'trigger-disabled': [value: boolean];
}>();

const { t } = useI18n();
const { currencies } = storeToRefs(useCurrenciesStore());
const invalidateRateHistory = useInvalidateRateHistory();

const { rates, isFetched, isLoadingError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = useRateHistory({
  code: props.code,
});

// Only a manual currency's rates are the user's to change. A synced source writes its own days, and
// a peg overrides every stored row, so those rows are shown but kept read-only.
const isEditable = computed(() => props.savedSource === 'manual');
const isPegged = computed(() => props.savedSource === 'peg');

const note = computed(() => {
  if (isPegged.value) return t('settings.currencies.rateSource.history.peggedNote', { code: props.code });
  if (!isEditable.value) {
    return t('settings.currencies.rateSource.history.syncedNote', {
      source: t(`settings.currencies.rateSource.sources.${props.savedSource}`),
    });
  }
  return '';
});

// A dated write needs both sides of the pair connected, so a row quoted in a currency the user does
// not hold can be removed but not edited.
const heldCodes = computed(() => new Set(currencies.value.map((item) => item.currencyCode)));
const isQuoteHeld = ({ quoteCode }: { quoteCode: string }) => heldCodes.value.has(quoteCode);

const formatDay = (day: string) => format(parseISO(day), 'PP');
const formatRate = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: RATE_MAX_FRACTION_DIGITS });

// The dialogs stay mounted after closing, with the row they last showed, so they can animate out.
const editingRate = ref<CurrencyRateHistoryItem | null>(null);
const removingRate = ref<CurrencyRateHistoryItem | null>(null);
const isEditOpen = ref(false);
const isRemoveOpen = ref(false);

const openEdit = ({ rate }: { rate: CurrencyRateHistoryItem }) => {
  editingRate.value = rate;
  isEditOpen.value = true;
};
const openRemove = ({ rate }: { rate: CurrencyRateHistoryItem }) => {
  removingRate.value = rate;
  isRemoveOpen.value = true;
};

const handleChanged = () => {
  invalidateRateHistory({ code: props.code });
  emit('changed');
};
</script>

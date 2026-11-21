<template>
  <div
    class="border-app-income-color/30 from-app-income-color/12 @container/settled-banner rounded-xl border bg-linear-to-r to-transparent p-4 sm:p-5"
  >
    <div
      class="flex flex-col gap-4 @lg/settled-banner:flex-row @lg/settled-banner:items-center @lg/settled-banner:justify-between"
    >
      <!-- Identity: check icon + name + type/opened/closed line. -->
      <div class="flex min-w-0 items-start gap-3">
        <CircleCheckIcon class="text-app-income-color mt-0.5 size-6 shrink-0" stroke-width="2" />
        <div class="min-w-0">
          <div class="text-base font-semibold">
            {{ $t('loans.detail.paidOff.bannerTitle', { name: loan.name }) }}
          </div>
          <div class="text-muted-foreground mt-0.5 text-sm">
            {{
              $t('loans.detail.paidOff.bannerSubline', {
                type: typeLabel,
                opened: openedDisplay,
                closed: closedDisplay,
              })
            }}
          </div>
        </div>
      </div>

      <!-- Stats: repaid / estimated interest / duration, plus an "N mo early" pill when applicable. -->
      <div
        class="flex flex-wrap items-center gap-x-6 gap-y-3 @lg/settled-banner:shrink-0 @lg/settled-banner:justify-end"
      >
        <div>
          <div class="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
            {{ $t('loans.paidOff.repaid') }}
          </div>
          <div class="mt-0.5 text-sm font-medium tabular-nums">{{ repaidDisplay }}</div>
        </div>
        <div>
          <div class="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
            {{ $t('loans.paidOff.interestPaid') }}
          </div>
          <div class="mt-0.5 text-sm font-medium tabular-nums">{{ interestDisplay }}</div>
        </div>
        <div>
          <div class="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
            {{ $t('loans.detail.paidOff.took') }}
          </div>
          <div class="mt-0.5 text-sm font-medium tabular-nums">{{ durationDisplay }}</div>
        </div>
        <span
          v-if="monthsEarly"
          class="bg-app-income-color/15 text-app-income-color inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
        >
          {{ $t('loans.detail.paidOff.monthsEarly', { count: monthsEarly }) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { LoanApi } from '@/api/loans';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import { CircleCheckIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { getLoanDurationParts, getMonthsEarly } from '../utils/paid-off-stats';

const props = defineProps<{ loan: LoanApi }>();

const { formatAmountByCurrencyCode } = useFormatCurrency();
const { format: formatDate } = useDateLocale();
const { t } = useI18n();

const startDate = computed(() => parseISO(props.loan.loanDetails.startDate));

// The last `paid_off` event is the definitive close date (a reopen appends a newer one).
const closedDate = computed(() => {
  const paidOffEvents = props.loan.loanDetails.events.filter((event) => event.type === 'paid_off');
  const last = paidOffEvents.at(-1)?.at;
  return last ? parseISO(last) : null;
});

const typeLabel = computed(() => t(`loans.types.${props.loan.loanDetails.loanType}`));

const openedDisplay = computed(() => formatDate(startDate.value, 'MMM yyyy'));
const closedDisplay = computed(() => (closedDate.value ? formatDate(closedDate.value, 'MMM d, yyyy') : '—'));

const repaidDisplay = computed(() =>
  formatAmountByCurrencyCode({
    amount: props.loan.loanDetails.originalPrincipal,
    currencyCode: props.loan.currencyCode,
  }),
);

const interestDisplay = computed(() => {
  const interest = props.loan.projection.estimatedInterestPaid;
  if (interest === null) return '—';
  return formatAmountByCurrencyCode({ amount: interest, currencyCode: props.loan.currencyCode });
});

const durationParts = computed(() =>
  getLoanDurationParts({ start: startDate.value, end: closedDate.value ?? new Date() }),
);

const durationDisplay = computed(() => {
  const { years, months } = durationParts.value;
  if (years > 0 && months > 0) return t('loans.detail.paidOff.duration.full', { years, months });
  if (years > 0) return t('loans.detail.paidOff.duration.years', { years });
  return t('loans.detail.paidOff.duration.months', { months });
});

const monthsEarly = computed(() =>
  closedDate.value
    ? getMonthsEarly({
        startDate: startDate.value,
        termMonths: props.loan.loanDetails.termMonths,
        closedDate: closedDate.value,
      })
    : null,
);
</script>

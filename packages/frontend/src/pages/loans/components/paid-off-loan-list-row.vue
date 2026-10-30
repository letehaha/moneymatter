<template>
  <RouterLink
    :to="{ name: ROUTES_NAMES.loanDetail, params: { id: loan.id } }"
    :class="
      cn(
        'hover:bg-muted/40 focus-visible:ring-ring/40 flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 @[40rem]/paid-off-list:py-3.5',
        'transition-colors focus-visible:ring-2 focus-visible:outline-none',
      )
    "
  >
    <div class="flex min-w-0 flex-1 basis-full items-center gap-3 @[40rem]/paid-off-list:basis-auto">
      <LoanLogo :loan="loan" class="size-8" />
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-semibold">{{ loan.name }}</span>
          <span
            class="bg-app-income-color/15 text-app-income-color inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium tracking-wider uppercase"
          >
            <CheckIcon class="size-2.5" stroke-width="2.5" />
            {{ $t('loans.detail.paidOffBadge') }}
          </span>
        </div>
        <div class="text-muted-foreground/70 mt-0.5 truncate text-xs">{{ subLine }}</div>
      </div>
    </div>

    <div class="hidden shrink-0 items-center gap-x-6 @[40rem]/paid-off-list:ml-auto @[40rem]/paid-off-list:flex">
      <div class="text-right">
        <div class="text-muted-foreground/70 text-[10px] font-semibold tracking-wider uppercase">
          {{ $t('loans.paidOff.repaid') }}
        </div>
        <div class="text-foreground mt-0.5 text-sm font-medium tabular-nums">{{ repaidDisplay }}</div>
      </div>

      <div class="text-right">
        <div class="text-muted-foreground/70 text-[10px] font-semibold tracking-wider uppercase">
          {{ $t('loans.paidOff.interestPaid') }}
        </div>
        <div class="text-foreground mt-0.5 text-sm font-medium tabular-nums">{{ interestPaidDisplay }}</div>
      </div>

      <div class="text-right">
        <div class="text-muted-foreground/70 text-[10px] font-semibold tracking-wider uppercase">
          {{ $t('loans.paidOff.opened') }}
        </div>
        <div class="text-foreground mt-0.5 text-sm font-medium tabular-nums">{{ openedDisplay }}</div>
      </div>

      <div class="text-right">
        <div class="text-muted-foreground/70 text-[10px] font-semibold tracking-wider uppercase">
          {{ $t('loans.paidOff.closed') }}
        </div>
        <div class="text-foreground mt-0.5 text-sm font-medium tabular-nums">{{ closedDisplay }}</div>
      </div>

      <ChevronRightIcon class="text-muted-foreground size-3.5" aria-hidden="true" />
    </div>

    <div class="text-muted-foreground flex basis-full flex-wrap gap-x-5 gap-y-1 text-xs @[40rem]/paid-off-list:hidden">
      <span>
        {{ $t('loans.paidOff.repaid') }}
        <span class="text-foreground font-medium tabular-nums">{{ repaidDisplay }}</span>
      </span>
      <span>
        {{ $t('loans.paidOff.interestPaid') }}
        <span class="text-foreground font-medium tabular-nums">{{ interestPaidDisplay }}</span>
      </span>
      <span>
        {{ $t('loans.paidOff.opened') }}
        <span class="text-foreground font-medium tabular-nums">{{ openedDisplay }}</span>
      </span>
      <span>
        {{ $t('loans.paidOff.closed') }}
        <span class="text-foreground font-medium tabular-nums">{{ closedDisplay }}</span>
      </span>
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import type { LoanApi } from '@/api/loans';
import LoanLogo from '@/components/common/loan-logo.vue';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes';
import { CheckIcon, ChevronRightIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

const props = defineProps<{ loan: LoanApi }>();

const { formatAmountByCurrencyCode } = useFormatCurrency();
const { format: formatDate } = useDateLocale();
const { t } = useI18n();

const DATE_FORMAT = 'MMM yyyy';

const repaidDisplay = computed(() =>
  formatAmountByCurrencyCode(props.loan.loanDetails.originalPrincipal, props.loan.currencyCode),
);

const interestPaidDisplay = computed(() => {
  const estimatedInterestPaid = props.loan.projection.estimatedInterestPaid;
  if (estimatedInterestPaid === null) return '—';
  return formatAmountByCurrencyCode(estimatedInterestPaid, props.loan.currencyCode);
});

const openedDisplay = computed(() => formatDate(parseISO(props.loan.loanDetails.startDate), DATE_FORMAT));

// A loan is marked paid off by a `paid_off` event; on reopen-then-repay a second one is appended,
// so the last event carries the definitive closed date.
const closedDate = computed(() => {
  const paidOffEvents = props.loan.loanDetails.events.filter((event) => event.type === 'paid_off');
  return paidOffEvents.at(-1)?.at ?? null;
});

const closedDisplay = computed(() => {
  const date = closedDate.value;
  if (!date) return '—';
  return formatDate(parseISO(date), DATE_FORMAT);
});

const subLine = computed(() => {
  const typeLabel = t(`loans.types.${props.loan.loanDetails.loanType}`);
  const lender = props.loan.loanDetails.lenderName;
  return lender ? `${typeLabel} · ${lender}` : `${typeLabel} · ${props.loan.currencyCode}`;
});
</script>

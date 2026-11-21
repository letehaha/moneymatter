<template>
  <Card class="@container/loan-summary">
    <CardHeader class="pb-3">
      <div class="flex items-start justify-between gap-3">
        <AccountLogoPicker :account-id="loan.id" class="size-10" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-xl font-semibold">{{ loan.name }}</div>
          <div v-if="loan.loanDetails.lenderName" class="text-muted-foreground mt-1 truncate text-sm">
            {{ loan.loanDetails.lenderName }}
          </div>
        </div>
        <div class="flex shrink-0 flex-col items-end gap-1.5">
          <span
            :class="
              cn(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.18em] uppercase',
                loanTypeSolidBadgeClass,
              )
            "
          >
            <span aria-hidden="true">{{ loanTypeEmoji }}</span>
            <span>{{ $t(`loans.types.${loan.loanDetails.loanType}`) }}</span>
          </span>
          <span
            v-if="loan.projection.isPaidOff"
            class="bg-app-income-color/15 text-app-income-color inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium tracking-wider uppercase"
          >
            {{ $t('loans.detail.paidOffBadge') }}
          </span>
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <!-- Active loans lead with the outstanding balance; paid-off loans surface that in the settled
           banner instead, so the card opens straight into the details grid. -->
      <template v-if="!isPaidOff">
        <div class="text-app-expense-color text-3xl font-semibold tracking-tight">
          {{ outstandingBalanceDisplay }}
        </div>
        <div class="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
          <span>{{ $t('loans.detail.summary.outstanding') }}</span>
          <DesktopOnlyTooltip :content="$t('loans.detail.summary.principalOnlyTooltip')" side="top">
            <InfoIcon class="size-3 cursor-help" />
          </DesktopOnlyTooltip>
        </div>
      </template>

      <div :class="cn('grid grid-cols-2 gap-4 text-sm @sm/loan-summary:grid-cols-3', isPaidOff ? '' : 'mt-5')">
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('loans.detail.summary.apr') }}</div>
          <div class="mt-0.5 font-medium">{{ aprDisplay }}</div>
        </div>
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('loans.detail.summary.originalPrincipal') }}</div>
          <div class="mt-0.5 font-medium">{{ originalPrincipalDisplay }}</div>
        </div>
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('loans.detail.summary.term') }}</div>
          <div class="mt-0.5 font-medium">{{ termDisplay }}</div>
        </div>
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('loans.detail.summary.startDate') }}</div>
          <div class="mt-0.5 font-medium">{{ startDateDisplay }}</div>
        </div>
        <div>
          <div class="text-muted-foreground flex items-center gap-1 text-xs">
            <span>{{ $t('loans.detail.summary.balanceAnchor') }}</span>
            <DesktopOnlyTooltip :content="$t('loans.detail.summary.balanceAnchorTooltip')" side="top">
              <InfoIcon class="size-3 cursor-help" />
            </DesktopOnlyTooltip>
          </div>
          <div class="mt-0.5 font-medium">{{ balanceAnchorDisplay }}</div>
        </div>
        <div>
          <div class="text-muted-foreground text-xs">{{ $t('loans.detail.summary.paymentDay') }}</div>
          <div class="mt-0.5 font-medium">{{ paymentDayDisplay }}</div>
        </div>
        <div v-if="loan.loanDetails.accountNumber">
          <div class="text-muted-foreground text-xs">{{ $t('loans.detail.summary.accountNumber') }}</div>
          <div class="mt-0.5 font-medium">{{ loan.loanDetails.accountNumber }}</div>
        </div>
        <template v-if="isPaidOff">
          <div>
            <div class="text-muted-foreground text-xs">{{ $t('loans.paidOff.opened') }}</div>
            <div class="mt-0.5 font-medium">{{ openedFullDisplay }}</div>
          </div>
          <div>
            <div class="text-muted-foreground text-xs">{{ $t('loans.paidOff.closed') }}</div>
            <div class="mt-0.5 font-medium">{{ closedFullDisplay }}</div>
          </div>
          <div>
            <div class="text-muted-foreground text-xs">{{ $t('loans.detail.summary.actualDuration') }}</div>
            <div class="mt-0.5 font-medium">{{ actualDurationDisplay }}</div>
          </div>
        </template>
      </div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import type { LoanApi } from '@/api/loans';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import AccountLogoPicker from '@/pages/account/components/account-logo-picker.vue';
import { InfoIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { getLoanDurationParts, getMonthsEarly } from '../utils/paid-off-stats';
import { outstandingAmount } from '../utils/outstanding-amount';
import { getLoanTypeEmoji, getLoanTypeSolidBadgeClass } from '../loan-type-presentation';

const props = defineProps<{ loan: LoanApi }>();

const { formatAmountByCurrencyCode } = useFormatCurrency();
const { format: formatDate } = useDateLocale();
const { t } = useI18n();

const aprDisplay = computed(() => `${props.loan.loanDetails.interestRate.toFixed(2)}%`);

const outstandingBalanceDisplay = computed(() =>
  formatAmountByCurrencyCode({
    amount: outstandingAmount({ balance: props.loan.currentBalance }),
    currencyCode: props.loan.currencyCode,
  }),
);

const originalPrincipalDisplay = computed(() =>
  formatAmountByCurrencyCode({
    amount: props.loan.loanDetails.originalPrincipal,
    currencyCode: props.loan.currencyCode,
  }),
);

const termDisplay = computed(() => {
  const months = props.loan.loanDetails.termMonths;
  if (months === null) return '—';
  return t('loans.detail.summary.termMonths', { count: months }, months);
});

const startDateDisplay = computed(() => formatDate(parseISO(props.loan.loanDetails.startDate), 'MMM d, yyyy'));

const balanceAnchorDisplay = computed(() =>
  formatDate(parseISO(props.loan.loanDetails.balanceAnchorDate), 'MMM d, yyyy'),
);

const paymentDayDisplay = computed(() => {
  const day = props.loan.loanDetails.paymentDayOfMonth;
  if (day === null) return '—';
  return t('loans.detail.summary.dayOfMonth', { day });
});

const loanTypeSolidBadgeClass = computed(() =>
  getLoanTypeSolidBadgeClass({ loanType: props.loan.loanDetails.loanType }),
);

const loanTypeEmoji = computed(() => getLoanTypeEmoji({ loanType: props.loan.loanDetails.loanType }));

const isPaidOff = computed(() => props.loan.projection.isPaidOff);

// Last `paid_off` event is the definitive close date (a reopen appends a newer one).
const closedDate = computed(() => {
  const paidOffEvents = props.loan.loanDetails.events.filter((event) => event.type === 'paid_off');
  const last = paidOffEvents.at(-1)?.at;
  return last ? parseISO(last) : null;
});

const openedFullDisplay = computed(() => formatDate(parseISO(props.loan.loanDetails.startDate), 'MMM d, yyyy'));
const closedFullDisplay = computed(() => (closedDate.value ? formatDate(closedDate.value, 'MMM d, yyyy') : '—'));

const actualDurationDisplay = computed(() => {
  if (!closedDate.value) return '—';
  const { totalMonths } = getLoanDurationParts({
    start: parseISO(props.loan.loanDetails.startDate),
    end: closedDate.value,
  });
  const base = t('loans.detail.summary.termMonths', { count: totalMonths }, totalMonths);
  const early = getMonthsEarly({
    startDate: parseISO(props.loan.loanDetails.startDate),
    termMonths: props.loan.loanDetails.termMonths,
    closedDate: closedDate.value,
  });
  if (early && early > 0) return `${base} · ${t('loans.detail.paidOff.monthsEarly', { count: early })}`;
  return base;
});
</script>

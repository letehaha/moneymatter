<template>
  <div
    class="hover:bg-muted/40 relative flex items-center gap-3 px-4 py-4 transition-colors @[40rem]/archived-list:py-3.5"
  >
    <!-- Overlay link keeps the whole row clickable without nesting the restore button inside an anchor. -->
    <RouterLink
      :to="{ name: ROUTES_NAMES.loanDetail, params: { id: loan.id } }"
      class="focus-visible:ring-ring/40 absolute inset-0 rounded-none focus-visible:ring-2 focus-visible:outline-none"
      :aria-label="loan.name"
    />

    <LoanLogo :loan="loan" class="size-8 opacity-70" />

    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-center gap-2">
        <span class="text-muted-foreground truncate text-sm font-semibold">{{ loan.name }}</span>
        <span
          class="bg-muted text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium tracking-wider uppercase"
        >
          <ArchiveIcon class="size-2.5" stroke-width="2.5" />
          {{ $t('loans.archivedList.badge') }}
        </span>
      </div>
      <div class="text-muted-foreground/70 mt-0.5 truncate text-xs">{{ subLine }}</div>
    </div>

    <div class="hidden text-right @[28rem]/archived-list:block">
      <div class="text-muted-foreground/70 text-[10px] font-semibold tracking-wider uppercase">
        {{ $t('loans.archivedList.outstanding') }}
      </div>
      <div class="text-muted-foreground mt-0.5 text-sm font-medium tabular-nums">{{ outstandingDisplay }}</div>
    </div>

    <DesktopOnlyTooltip :content="$t('loans.settings.unarchiveButton')">
      <Button
        variant="ghost"
        size="icon-sm"
        class="relative shrink-0"
        :disabled="isPending"
        :aria-label="$t('loans.settings.unarchiveButton')"
        @click="unarchive({ loan })"
      >
        <ArchiveRestoreIcon class="size-4" />
      </Button>
    </DesktopOnlyTooltip>
  </div>
</template>

<script setup lang="ts">
import type { LoanApi } from '@/api/loans';
import LoanLogo from '@/components/common/loan-logo.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable/formatters';
import { ROUTES_NAMES } from '@/routes';
import { ArchiveIcon, ArchiveRestoreIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

import { useUnarchiveLoan } from '../composables/use-unarchive-loan';
import { outstandingAmount } from '../utils/outstanding-amount';

const props = defineProps<{ loan: LoanApi }>();

const { formatAmountByCurrencyCode } = useFormatCurrency();
const { t } = useI18n();
const { unarchive, isPending } = useUnarchiveLoan();

const outstandingDisplay = computed(() =>
  formatAmountByCurrencyCode(outstandingAmount({ balance: props.loan.currentBalance }), props.loan.currencyCode),
);

const subLine = computed(() => {
  const typeLabel = t(`loans.types.${props.loan.loanDetails.loanType}`);
  const lender = props.loan.loanDetails.lenderName;
  return lender ? `${typeLabel} · ${lender}` : `${typeLabel} · ${props.loan.currencyCode}`;
});
</script>

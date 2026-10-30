<script setup lang="ts">
import { formatShortDate } from '@/common/utils/date';
import VentureDealLogo from '@/components/common/venture-deal-logo.vue';
import DealStatusPill from '@/pages/venture/components/deal-status-pill.vue';
import { useFormatCurrency } from '@/composable/formatters';
import { ROUTES_NAMES } from '@/routes';
import { type VentureDealModel } from '@bt/shared/types';

defineProps<{
  deal: VentureDealModel;
}>();

const { formatAmountByCurrencyCode } = useFormatCurrency();
</script>

<template>
  <router-link
    :to="{ name: ROUTES_NAMES.ventureDealDetail, params: { dealId: deal.id } }"
    class="bg-card border-border hover:bg-accent/30 block rounded-xl border p-5 transition-colors"
  >
    <div class="flex flex-col gap-4">
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-start gap-3">
          <VentureDealLogo :deal="deal" class="size-10" />
          <div class="min-w-0">
            <h3 class="text-lg leading-tight font-semibold tracking-tight">{{ deal.name }}</h3>
            <div class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span v-if="deal.platform">{{ deal.platform.name }}</span>
              <span v-if="deal.platform && deal.targetCompany" aria-hidden="true">·</span>
              <span v-if="deal.targetCompany">{{ deal.targetCompany }}</span>
            </div>
          </div>
        </div>
        <DealStatusPill :status="deal.status" size="sm" />
      </div>

      <div class="border-border/60 grid grid-cols-3 gap-3 border-t pt-3">
        <div>
          <div class="text-muted-foreground text-[10px] tracking-wide uppercase">
            {{ $t('venture.deals.principal') }}
          </div>
          <div class="mt-0.5 text-lg font-semibold tabular-nums">
            {{ formatAmountByCurrencyCode(Number(deal.principal), deal.currencyCode) }}
          </div>
        </div>
        <div>
          <div class="text-muted-foreground text-[10px] tracking-wide uppercase">
            {{ $t('venture.deals.entryFee') }}
          </div>
          <div class="text-muted-foreground mt-0.5 text-sm tabular-nums">
            {{ formatAmountByCurrencyCode(Number(deal.entryFee), deal.currencyCode) }}
          </div>
        </div>
        <div>
          <div class="text-muted-foreground text-[10px] tracking-wide uppercase">
            {{ $t('venture.deals.investmentDate') }}
          </div>
          <div class="text-muted-foreground mt-0.5 text-sm">{{ formatShortDate(deal.investmentDate) }}</div>
        </div>
      </div>
    </div>
  </router-link>
</template>

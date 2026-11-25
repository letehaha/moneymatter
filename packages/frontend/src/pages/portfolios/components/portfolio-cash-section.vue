<template>
  <Card class="@container/cash min-w-0">
    <CardHeader class="pb-4">
      <div class="flex items-center justify-between gap-3">
        <CardTitle class="text-lg">{{ $t('portfolioDetail.cash.title') }}</CardTitle>

        <div class="hidden items-center gap-2 @lg/cash:flex">
          <UiButton variant="outline" size="sm" @click="isCashTxOpen = true">
            <PlusIcon class="size-4" />
            {{ $t('portfolioDetail.cashBalances.cashTransactions.addButton') }}
          </UiButton>
          <UiButton variant="outline" size="sm" @click="isTransferOpen = true">
            <ArrowRightLeftIcon class="size-4" />
            {{ $t('portfolioDetail.actions.transfer') }}
          </UiButton>
          <UiButton variant="outline" size="sm" @click="isExchangeOpen = true">
            <RefreshCwIcon class="size-4" />
            {{ $t('portfolioDetail.actions.exchangeCurrency') }}
          </UiButton>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <span class="inline-flex @lg/cash:hidden">
              <DesktopOnlyTooltip :content="$t('common.actions.more')">
                <UiButton variant="outline" size="icon-sm" :aria-label="$t('common.actions.more')">
                  <EllipsisVerticalIcon class="size-4" />
                </UiButton>
              </DesktopOnlyTooltip>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @click="isCashTxOpen = true">
              <PlusIcon class="size-4" />
              {{ $t('portfolioDetail.cashBalances.cashTransactions.addButton') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="isTransferOpen = true">
              <ArrowRightLeftIcon class="size-4" />
              {{ $t('portfolioDetail.actions.transfer') }}
            </DropdownMenuItem>
            <DropdownMenuItem @click="isExchangeOpen = true">
              <RefreshCwIcon class="size-4" />
              {{ $t('portfolioDetail.actions.exchangeCurrency') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </CardHeader>
    <CardContent class="pt-0">
      <PortfolioCashOverview :portfolio-id="portfolio.id" />
    </CardContent>

    <DirectCashTransactionDialog v-model:open="isCashTxOpen" :portfolio-id="portfolio.id" :portfolio="portfolio" />
    <PortfolioTransferDialog v-model:open="isTransferOpen" :portfolio="portfolio" context="portfolio" />
    <ExchangeCurrencyDialog v-model:open="isExchangeOpen" :portfolio-id="portfolio.id" :portfolio="portfolio" />
  </Card>
</template>

<script setup lang="ts">
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import DirectCashTransactionDialog from '@/components/dialogs/direct-cash-transaction-dialog.vue';
import ExchangeCurrencyDialog from '@/components/dialogs/exchange-currency-dialog.vue';
import PortfolioTransferDialog from '@/components/dialogs/portfolio-transfer-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/lib/ui/card';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import type { PortfolioModel } from '@bt/shared/types';
import { ArrowRightLeftIcon, EllipsisVerticalIcon, PlusIcon, RefreshCwIcon } from '@lucide/vue';
import { ref } from 'vue';

import PortfolioCashOverview from './portfolio-cash-overview.vue';

defineProps<{ portfolio: PortfolioModel }>();

const isCashTxOpen = ref(false);
const isTransferOpen = ref(false);
const isExchangeOpen = ref(false);
</script>

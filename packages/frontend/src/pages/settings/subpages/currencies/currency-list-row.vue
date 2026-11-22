<template>
  <component
    :is="isBase ? 'div' : 'button'"
    :type="isBase ? undefined : 'button'"
    :class="
      cn(
        'grid w-full grid-cols-[minmax(0,1fr)_14px] items-center gap-3 px-4 py-3 text-left',
        !isBase &&
          'hover:bg-hover focus-visible:ring-ring/40 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:outline-none',
      )
    "
    @click="onTriggerClick"
  >
    <div
      class="flex min-w-0 flex-col gap-2 @[30rem]/currencies:flex-row @[30rem]/currencies:items-center @[30rem]/currencies:gap-3"
    >
      <div class="flex min-w-0 items-center gap-3 @[30rem]/currencies:flex-1">
        <div class="bg-muted flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg">
          <CurrencyIcon :code="code" size="size-5" />
        </div>

        <div class="min-w-0">
          <div class="flex min-w-0 flex-wrap items-center gap-1.5">
            <span class="truncate text-sm font-semibold">{{ currency.name }}</span>

            <span
              v-if="isBase"
              class="bg-primary text-primary-foreground shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
            >
              {{ $t('settings.currencies.row.baseBadge') }}
            </span>

            <template v-else>
              <span
                :class="
                  cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                    currency.isCustomCurrency || currency.custom
                      ? 'bg-primary/15 text-primary-text'
                      : 'bg-muted text-muted-foreground',
                  )
                "
                :data-testid="currency.isCustomCurrency ? 'custom-currency-badge' : undefined"
              >
                {{ rateKindLabel }}
              </span>

              <span
                :class="
                  cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
                    accountsCount > 0 ? 'bg-muted text-muted-foreground' : 'bg-muted/60 text-muted-foreground/70',
                  )
                "
              >
                {{
                  accountsCount > 0
                    ? $t('settings.currencies.row.accountsCount', { count: accountsCount }, accountsCount)
                    : $t('settings.currencies.row.unused')
                }}
              </span>
            </template>
          </div>

          <div class="text-muted-foreground mt-0.5 text-xs tabular-nums">
            {{ code }}
          </div>
        </div>
      </div>

      <div v-if="!isBase" class="pl-12 @[30rem]/currencies:pl-0 @[30rem]/currencies:text-right">
        <div class="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 @[30rem]/currencies:block">
          <div class="text-sm font-semibold tabular-nums">
            <span class="text-muted-foreground text-xs font-normal">1 {{ code }} =</span>
            {{ rateDisplay }}
            <span class="text-muted-foreground text-xs font-normal">{{ quoteCode }}</span>
          </div>
          <div class="text-sm font-semibold tabular-nums">
            <span class="text-muted-foreground text-xs font-normal">1 {{ quoteCode }} =</span>
            {{ quoteRateDisplay }}
            <span class="text-muted-foreground text-xs font-normal">{{ code }}</span>
          </div>
        </div>
      </div>
    </div>

    <ChevronRightIcon v-if="!isBase" class="text-muted-foreground size-3.5" aria-hidden="true" />
    <span v-else class="size-3.5" aria-hidden="true" />
  </component>
</template>

<script setup lang="ts">
import CurrencyIcon from '@/components/common/currency-icon.vue';
import { toLocalNumber } from '@/js/helpers/formatters';
import { cn } from '@/lib/utils';
import { ChevronRightIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { rateDisplayOptions } from './rate-precision';
import { CurrencyWithExchangeRate } from './types';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  accountsCount: number;
}>();

const emit = defineEmits<{
  select: [];
}>();

const { t } = useI18n();

const isBase = computed(() => props.currency.isDefaultCurrency);
const code = computed(() => props.currency.currency?.code ?? '');
const quoteCode = computed(() => props.currency.quoteCode);

const RATE_DISPLAY_DECIMALS = 6;
const formatRate = (value: number) =>
  Number.isFinite(value)
    ? toLocalNumber(
        value,
        rateDisplayOptions({ isCustom: props.currency.isCustomCurrency, isoDecimals: RATE_DISPLAY_DECIMALS }),
      )
    : '—';
const rateKindLabel = computed(() => {
  if (props.currency.isCustomCurrency) return t('settings.currencies.row.customCurrency');
  return props.currency.custom ? t('settings.currencies.row.custom') : t('settings.currencies.row.live');
});
const rateDisplay = computed(() => formatRate(props.currency.rate));
const quoteRateDisplay = computed(() => formatRate(props.currency.quoteRate));

const onTriggerClick = () => {
  if (isBase.value) return;
  emit('select');
};
</script>

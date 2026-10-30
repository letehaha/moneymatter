<template>
  <Collapsible :open="expanded">
    <component
      :is="isBase ? 'div' : 'button'"
      :type="isBase ? undefined : 'button'"
      :aria-expanded="isBase ? undefined : expanded"
      :class="
        cn(
          'grid w-full grid-cols-[minmax(0,1fr)_14px] items-center gap-3 px-4 py-3 text-left',
          !isBase &&
            'hover:bg-muted/40 focus-visible:ring-ring/40 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:outline-none',
        )
      "
      @click="onTriggerClick"
    >
      <div
        class="flex min-w-0 flex-col gap-2 @[30rem]/currencies:flex-row @[30rem]/currencies:items-center @[30rem]/currencies:gap-3"
      >
        <div class="flex min-w-0 items-center gap-3 @[30rem]/currencies:flex-1">
          <div class="bg-muted flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg">
            <img
              v-if="flagUrl && !flagFailed"
              :src="flagUrl"
              :alt="code"
              class="size-5"
              loading="lazy"
              @error="flagFailed = true"
            />
            <CoinsIcon v-else class="text-muted-foreground size-4.5" aria-hidden="true" />
          </div>

          <div class="min-w-0">
            <div class="flex min-w-0 flex-wrap items-center gap-1.5">
              <span class="truncate text-sm font-semibold">{{ currencyName }}</span>

              <span
                v-if="isBase"
                class="bg-primary text-primary-foreground shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              >
                {{ $t('settings.currencies.row.baseBadge') }}
              </span>

              <template v-else>
                <span
                  :class="
                    cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      currency.custom ? 'bg-primary/15 text-primary-text' : 'bg-muted text-muted-foreground',
                    )
                  "
                >
                  {{ currency.custom ? $t('settings.currencies.row.custom') : $t('settings.currencies.row.live') }}
                </span>

                <span
                  :class="
                    cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
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
              <span class="text-muted-foreground text-xs font-normal">{{ baseCode }}</span>
            </div>
            <div class="text-sm font-semibold tabular-nums">
              <span class="text-muted-foreground text-xs font-normal">1 {{ baseCode }} =</span>
              {{ quoteRateDisplay }}
              <span class="text-muted-foreground text-xs font-normal">{{ code }}</span>
            </div>
          </div>
        </div>
      </div>

      <ChevronDownIcon
        v-if="!isBase"
        class="text-muted-foreground size-3.5 transition-transform"
        :class="{ 'rotate-180': expanded }"
        aria-hidden="true"
      />
      <span v-else class="size-3.5" aria-hidden="true" />
    </component>

    <CollapsibleContent v-if="!isBase" scroll-into-view>
      <div class="border-border/60 bg-muted/20 border-t px-4 py-4">
        <ExchangeRateForm
          :currency="currency"
          :is-form-disabled="isFormDisabled"
          @submit="handleSubmit"
          @trigger-disabled="isFormDisabled = $event"
        />

        <div class="bg-border/60 my-4 h-px w-full" />

        <div class="flex items-center justify-between gap-3">
          <SetBaseCurrency
            :currency="currency"
            :is-form-disabled="isFormDisabled"
            @submit="handleSubmit"
            @trigger-disabled="isFormDisabled = $event"
          />
          <DeleteCurrency
            :currency="currency"
            :is-form-disabled="isFormDisabled"
            :is-deletion-disabled="accountsCount > 0"
            @submit="handleSubmit"
            @trigger-disabled="isFormDisabled = $event"
          />
        </div>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>

<script setup lang="ts">
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useCurrencyName } from '@/composable';
import { getCurrencyIcon } from '@/js/helpers/currencyImage';
import { toLocalNumber } from '@/js/helpers/formatters';
import { Collapsible, CollapsibleContent } from '@/components/lib/ui/collapsible';
import { cn } from '@/lib/utils';
import { useCurrenciesStore } from '@/stores';
import { useQueryClient } from '@tanstack/vue-query';
import { ChevronDownIcon, CoinsIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import ExchangeRateForm from './currency-row/exchange-rate-form.vue';
import DeleteCurrency from './currency-row/delete-currency.vue';
import SetBaseCurrency from './currency-row/set-base-currency.vue';
import { CurrencyWithExchangeRate } from './types';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
  accountsCount: number;
  expanded: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
  submit: [];
}>();

const currenciesStore = useCurrenciesStore();
const { baseCurrency } = storeToRefs(currenciesStore);
const queryClient = useQueryClient();
const { getCurrencyName } = useCurrencyName();

const isFormDisabled = ref(false);
const flagFailed = ref(false);

const isBase = computed(() => props.currency.isDefaultCurrency);
const code = computed(() => props.currency.currency?.code ?? '');
const baseCode = computed(() => baseCurrency.value?.currency?.code ?? '');
const currencyName = computed(() =>
  getCurrencyName({
    code: code.value,
    fallbackName: props.currency.currency?.currency,
  }),
);

const flagUrl = computed(() => (code.value ? getCurrencyIcon(code.value) : ''));

const formatRate = (value: number) =>
  Number.isFinite(value) ? toLocalNumber(value, { minimumFractionDigits: 0, maximumFractionDigits: 6 }) : '—';
const rateDisplay = computed(() => formatRate(props.currency.rate));
const quoteRateDisplay = computed(() => formatRate(props.currency.quoteRate));

const onTriggerClick = () => {
  if (isBase.value) return;
  emit('toggle');
};

// Mirror the previous dialog-close refresh: pull fresh currencies and re-run the
// exchange-rates query so the row reflects the saved rate (or vanishes on delete).
const handleSubmit = async () => {
  emit('submit');
  await currenciesStore.loadCurrencies({ force: true });
  queryClient.invalidateQueries({
    queryKey: VUE_QUERY_CACHE_KEYS.exchangeRates,
  });
};
</script>

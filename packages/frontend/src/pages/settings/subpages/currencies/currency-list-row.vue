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
            <CurrencyIcon :code="code" size="size-5" />
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
                  v-if="isCustomCurrency"
                  class="bg-primary/15 text-primary-text shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  data-testid="custom-currency-badge"
                >
                  {{ $t('settings.currencies.row.customCurrency') }}
                </span>
                <span
                  v-else
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

        <div class="pl-12 @[30rem]/currencies:pl-0 @[30rem]/currencies:text-right">
          <template v-if="isBase">
            <div class="text-sm font-semibold tabular-nums">
              1
              <span class="text-muted-foreground text-xs font-normal">{{ code }} / {{ code }}</span>
            </div>
          </template>
          <template v-else>
            <div class="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 @[30rem]/currencies:block">
              <div class="text-sm font-semibold tabular-nums">
                {{ rateDisplay }}
                <span class="text-muted-foreground text-xs font-normal">{{ code }} / {{ baseCode }}</span>
              </div>
              <div class="text-sm font-semibold tabular-nums">
                {{ quoteRateDisplay }}
                <span class="text-muted-foreground text-xs font-normal"> {{ baseCode }} / {{ code }}</span>
              </div>
            </div>
          </template>
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
        <RateSourceEditor
          v-if="isCustomCurrency"
          :currency="currency"
          :is-form-disabled="isFormDisabled"
          @submit="handleSubmit"
          @changed="refreshAfterRateChange"
          @trigger-disabled="isFormDisabled = $event"
        />
        <ExchangeRateForm
          v-else
          :currency="currency"
          :is-form-disabled="isFormDisabled"
          @submit="handleSubmit"
          @trigger-disabled="isFormDisabled = $event"
        />

        <div class="bg-border/60 my-4 h-px w-full" />

        <div class="flex items-center justify-between gap-3">
          <Button
            v-if="isCustomCurrency"
            variant="outline"
            size="sm"
            class="whitespace-nowrap"
            :disabled="isFormDisabled"
            data-testid="edit-custom-currency"
            @click="isEditOpen = true"
          >
            <PencilIcon class="size-4" />
            {{ $t('settings.currencies.row.edit') }}
          </Button>
          <SetBaseCurrency
            v-else
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

  <CustomCurrencyDialog
    v-if="editableCurrency"
    v-model:open="isEditOpen"
    :currency="editableCurrency"
    :accounts-count="accountsCount"
  />
</template>

<script setup lang="ts">
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useCurrencyName } from '@/composable';
import CurrencyIcon from '@/components/common/currency-icon.vue';
import { Button } from '@/components/lib/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/lib/ui/collapsible';
import { cn } from '@/lib/utils';
import { useCurrenciesStore } from '@/stores';
import { useQueryClient } from '@tanstack/vue-query';
import { ChevronDownIcon, PencilIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import CustomCurrencyDialog from './custom-currency-dialog.vue';
import ExchangeRateForm from './currency-row/exchange-rate-form.vue';
import RateSourceEditor from './rate-source/rate-source-editor.vue';
import { useRefreshAfterCurrencyChange } from './use-refresh-after-currency-change';
import DeleteCurrency from './currency-row/delete-currency.vue';
import SetBaseCurrency from './currency-row/set-base-currency.vue';
import { CurrencyWithExchangeRate, EditableCustomCurrency } from './types';

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
const refreshAfterCurrencyChange = useRefreshAfterCurrencyChange();
const { getCurrencyName } = useCurrencyName();

const isFormDisabled = ref(false);

const isBase = computed(() => props.currency.isDefaultCurrency);
const isCustomCurrency = computed(() => Boolean(props.currency.currency?.isCustom));
const isEditOpen = ref(false);
const editableCurrency = computed<EditableCustomCurrency | null>(() => {
  const effective = props.currency.currency;
  if (!effective?.isCustom) return null;

  return { code: effective.code, name: effective.currency, symbol: effective.symbol, decimals: effective.digits };
});
const code = computed(() => props.currency.currency?.code ?? '');
const baseCode = computed(() => baseCurrency.value?.currency?.code ?? '');
// A custom currency carries the name its owner gave it; a translated ISO name could shadow it.
const currencyName = computed(() =>
  isCustomCurrency.value
    ? (props.currency.currency?.currency ?? code.value)
    : getCurrencyName({
        code: code.value,
        fallbackName: props.currency.currency?.currency,
      }),
);

// A custom currency can be worth a tiny fraction of its quote, so its rate shows more digits.
const CUSTOM_RATE_MAX_FRACTION_DIGITS = 12;
const formatRate = (value: number) =>
  Number.isFinite(value)
    ? value.toLocaleString(
        undefined,
        isCustomCurrency.value ? { maximumFractionDigits: CUSTOM_RATE_MAX_FRACTION_DIGITS } : undefined,
      )
    : '—';
const rateDisplay = computed(() => formatRate(props.currency.rate));
const quoteRateDisplay = computed(() => formatRate(props.currency.quoteRate));

const onTriggerClick = () => {
  if (isBase.value) return;
  emit('toggle');
};

// A saved rate changes the amounts valued by it, so a custom currency refreshes everything that
// carries its base-currency amounts; an ISO currency only its own rates.
const refreshAfterRateChange = async () => {
  if (isCustomCurrency.value) {
    await refreshAfterCurrencyChange();
    return;
  }
  await currenciesStore.loadCurrencies({ force: true });
  queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.exchangeRates });
};

const handleSubmit = async () => {
  emit('submit');
  await refreshAfterRateChange();
};
</script>

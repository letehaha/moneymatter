<template>
  <div
    :class="
      cn(
        'flex items-center gap-3 rounded-lg border p-3 transition-colors',
        disabled ? 'cursor-default opacity-80' : 'cursor-pointer',
        selected ? 'border-primary bg-primary/10' : cn('border-border', !disabled && 'hover:border-primary/45'),
      )
    "
    @click="!disabled && emit('toggle')"
  >
    <AccountVisualChip :account="account" :provider-type="providerType" />

    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="truncate text-sm font-semibold">{{ account.name }}</span>
        <span
          v-if="needsCurrency"
          class="border-warning-text/55 text-warning-text shrink-0 rounded border px-1.5 py-px text-[10px] font-bold tracking-wide"
        >
          {{ $t('pages.integrations.common.noCurrencyBadge') }}
        </span>
        <span
          v-else
          class="border-border text-muted-foreground shrink-0 rounded border px-1.5 py-px text-[10px] font-bold tracking-wide"
        >
          {{ account.currency }}
        </span>
      </div>
      <p v-if="meta" class="text-muted-foreground mt-0.5 truncate text-xs tabular-nums">{{ meta }}</p>
      <!-- click.stop: the whole row toggles selection on click -->
      <div v-if="needsCurrency && selected" class="mt-2 max-w-60" @click.stop>
        <IntegrationCurrencySelect
          :model-value="currencyOverride ?? null"
          :disabled="disabled"
          @update:model-value="(code) => emit('update:currencyOverride', code)"
        />
      </div>
    </div>

    <span
      :class="
        cn(
          'shrink-0 text-sm font-semibold whitespace-nowrap tabular-nums',
          account.balance === 0 && 'text-muted-foreground font-normal',
        )
      "
    >
      {{ formattedBalance }}
    </span>

    <Checkbox
      :model-value="selected"
      :disabled="disabled"
      class="size-5"
      :aria-label="account.name"
      @update:model-value="emit('toggle')"
      @click.stop
    />
  </div>
</template>

<script lang="ts" setup>
import { toLocalNumber } from '@/js/helpers/formatters';
import { type AvailableAccount, NO_CURRENCY_CODE } from '@/api/bank-data-providers';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { computed } from 'vue';

import AccountVisualChip from './account-visual-chip.vue';
import IntegrationCurrencySelect from './integration-currency-select.vue';

const props = defineProps<{
  account: AvailableAccount;
  providerType?: BANK_PROVIDER_TYPE;
  selected: boolean;
  disabled?: boolean;
  /** Secondary line under the name (institution, IBAN, credit limit, …). */
  meta?: string | null;
  /** User-picked currency for accounts listed without one. */
  currencyOverride?: string | null;
}>();

const emit = defineEmits<{
  toggle: [];
  'update:currencyOverride': [code: string | null];
}>();

const needsCurrency = computed(() => props.account.currency === NO_CURRENCY_CODE);

const { formatAmountByCurrencyCode } = useFormatCurrency();

// No-currency accounts can't be currency-formatted — show a plain number.
const formattedBalance = computed(() =>
  needsCurrency.value
    ? toLocalNumber(props.account.balance, { maximumFractionDigits: 2 })
    : formatAmountByCurrencyCode(props.account.balance, props.account.currency),
);
</script>

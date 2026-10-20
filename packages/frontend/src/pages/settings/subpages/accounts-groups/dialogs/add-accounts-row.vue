<script setup lang="ts">
import AccountLogo from '@/components/common/account-logo.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { useFormatCurrency } from '@/composable';
import { useAccountDisplayBalance } from '@/composable/use-account-display-balance';
import { cn } from '@/lib/utils';
import { AccountModel } from '@bt/shared/types';
import { toRef } from 'vue';

const props = defineProps<{ account: AccountModel; checked: boolean; disabled?: boolean; caption?: string }>();
const emit = defineEmits<{ toggle: [] }>();

const { formatAmountByCurrencyCode } = useFormatCurrency();
const { displayBalance } = useAccountDisplayBalance({ account: toRef(() => props.account) });
</script>

<template>
  <label
    :class="
      cn(
        'flex items-center gap-3 px-3 py-2',
        disabled ? 'cursor-default opacity-60' : 'hover:bg-muted/50 cursor-pointer',
      )
    "
  >
    <Checkbox :model-value="checked" :disabled="disabled" @update:model-value="emit('toggle')" />
    <AccountLogo :account="account" class="size-8" />

    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-medium">{{ account.name }}</span>
      <span v-if="caption" class="text-muted-foreground block truncate text-xs">{{ caption }}</span>
    </span>

    <span class="text-muted-foreground shrink-0 text-sm tabular-nums">
      {{ formatAmountByCurrencyCode(displayBalance, account.currencyCode) }}
    </span>
  </label>
</template>

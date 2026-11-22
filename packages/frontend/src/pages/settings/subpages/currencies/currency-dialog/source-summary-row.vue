<template>
  <div class="border-border flex items-center gap-3 rounded-xl border px-3.5 py-3" data-testid="source-summary-row">
    <div class="grid min-w-0 flex-1 gap-0.5">
      <span class="text-muted-foreground text-xs">{{ $t('settings.currencies.dialog.source.label') }}</span>
      <span class="text-sm font-semibold break-words" data-testid="source-summary-value">{{ summary.value }}</span>
      <span v-if="summary.detail" class="text-muted-foreground text-xs break-words" data-testid="source-summary-detail">
        {{ summary.detail }}
      </span>
    </div>
    <Button variant="outline" size="sm" class="shrink-0" data-testid="source-summary-change" @click="emit('change')">
      {{ $t('settings.currencies.dialog.source.change') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { CurrencyWithExchangeRate } from '../types';
import { describeRateSource } from './source-summary';

const props = defineProps<{
  currency: CurrencyWithExchangeRate;
}>();

const emit = defineEmits<{ change: [] }>();

const { t } = useI18n();

const summary = computed(() => describeRateSource({ currency: props.currency, t }));
</script>

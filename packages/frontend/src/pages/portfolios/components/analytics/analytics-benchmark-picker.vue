<script setup lang="ts">
import * as Select from '@/components/lib/ui/select';
import { PORTFOLIO_BENCHMARKS, PORTFOLIO_BENCHMARK_KEYS, type PortfolioBenchmark } from '@bt/shared/types/investments';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { resolveBenchmark } from './analytics-derivations';

const props = defineProps<{ modelValue: PortfolioBenchmark | null }>();

const emit = defineEmits<{ 'update:modelValue': [value: PortfolioBenchmark | null] }>();

const { t } = useI18n();

const NONE = 'none';

const options = computed(() =>
  PORTFOLIO_BENCHMARK_KEYS.map((key) => {
    const { name, providerSymbol, isFundProxy } = PORTFOLIO_BENCHMARKS[key];
    return {
      value: key,
      label: name,
      proxy: isFundProxy ? t('portfolioDetail.analytics.relative.benchmarkProxy', { symbol: providerSymbol }) : null,
    };
  }),
);

const selectedLabel = computed(() =>
  props.modelValue ? PORTFOLIO_BENCHMARKS[props.modelValue].name : t('portfolioDetail.analytics.relative.noBenchmark'),
);

const onChange = (value: unknown) => emit('update:modelValue', resolveBenchmark({ stored: String(value) }));
</script>

<template>
  <Select.Select :model-value="modelValue ?? NONE" @update:model-value="onChange">
    <Select.SelectTrigger
      size="xs"
      class="w-auto gap-2"
      :aria-label="$t('portfolioDetail.analytics.relative.benchmarkLabel')"
    >
      <span class="truncate">{{ selectedLabel }}</span>
    </Select.SelectTrigger>
    <Select.SelectContent align="end">
      <Select.SelectItem :value="NONE">{{ $t('portfolioDetail.analytics.relative.noBenchmark') }}</Select.SelectItem>
      <Select.SelectItem v-for="option in options" :key="option.value" :value="option.value">
        <span class="flex items-baseline justify-between gap-3">
          {{ option.label }}
          <span v-if="option.proxy" class="text-muted-foreground text-xs">{{ option.proxy }}</span>
        </span>
      </Select.SelectItem>
    </Select.SelectContent>
  </Select.Select>
</template>

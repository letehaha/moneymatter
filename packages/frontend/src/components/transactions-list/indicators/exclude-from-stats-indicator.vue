<template>
  <TooltipProvider v-if="transaction.excludeFromStats" :delay-duration="0">
    <Tooltip>
      <TooltipTrigger as-child>
        <div
          :class="
            cn(
              'flex shrink-0 items-center justify-center',
              compact ? 'size-4' : 'size-6 gap-0.5 rounded-sm border px-1 py-0.5 text-xs',
              'border-border text-muted-foreground',
            )
          "
          :aria-label="t('transactions.excludeFromStats.label')"
        >
          <EyeOffIcon :class="compact ? 'size-3.5' : 'size-4'" />
        </div>
      </TooltipTrigger>
      <TooltipContent>{{ t('transactions.excludeFromStats.tooltip') }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<script lang="ts" setup>
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/lib/ui/tooltip';
import { cn } from '@/lib/utils';
import { TransactionModel } from '@bt/shared/types';
import { EyeOffIcon } from '@lucide/vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

withDefaults(
  defineProps<{
    transaction: TransactionModel;
    /** Icon-only rendering. */
    compact?: boolean;
  }>(),
  { compact: false },
);
</script>

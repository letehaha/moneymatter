<template>
  <div class="flex flex-col items-center px-4 py-12 text-center">
    <div class="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
      <component :is="status === 'no-data' ? FlameIcon : CalendarClockIcon" class="text-muted-foreground size-6" />
    </div>
    <h2 class="text-foreground mb-2 text-lg font-semibold text-balance">
      {{ $t(`analytics.fire.empty.${variant}.title`, { n: monthsUsed }, monthsUsed) }}
    </h2>
    <p class="text-muted-foreground mb-5 max-w-md text-sm">
      {{ $t(`analytics.fire.empty.${variant}.description`) }}
    </p>
    <div class="flex flex-wrap items-center justify-center gap-2">
      <Button @click="emit('enterSpending')">{{ $t('analytics.fire.empty.enterSpending') }}</Button>
      <Button v-if="status === 'no-data'" variant="outline" as-child>
        <RouterLink :to="{ name: ROUTES_NAMES.accounts }">{{ $t('analytics.fire.empty.addAccount') }}</RouterLink>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { FIRE_SEED_MIN_MONTHS } from '@/composable/fire/derive-fire-seed';
import { ROUTES_NAMES } from '@/routes/constants';
import { CalendarClockIcon, FlameIcon } from '@lucide/vue';
import { computed } from 'vue';

const props = defineProps<{ status: 'no-data' | 'needs-spending'; monthsUsed: number }>();
const emit = defineEmits<{ enterSpending: [] }>();

const variant = computed(() => {
  if (props.status === 'no-data') return 'noData';
  return props.monthsUsed >= FIRE_SEED_MIN_MONTHS ? 'noSpending' : 'shortHistory';
});
</script>

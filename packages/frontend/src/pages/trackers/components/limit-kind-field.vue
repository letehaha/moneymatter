<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { ROUTES_NAMES } from '@/routes';
import { TRACKER_LIMIT_KINDS } from '@bt/shared/types';
import { ArrowDownIcon, ArrowUpIcon, ArrowUpToLineIcon, CircleHelpIcon } from '@lucide/vue';
import { type Component, computed } from 'vue';
import { useI18n } from 'vue-i18n';

defineProps<{ disabled?: boolean }>();
const kind = defineModel<TRACKER_LIMIT_KINDS>({ required: true });

const { t } = useI18n();

const kinds = Object.values(TRACKER_LIMIT_KINDS);
const KIND_ICONS: Record<TRACKER_LIMIT_KINDS, { icon: Component; class: string }> = {
  [TRACKER_LIMIT_KINDS.spending]: { icon: ArrowDownIcon, class: 'bg-app-expense-color/15 text-app-expense-color' },
  [TRACKER_LIMIT_KINDS.incomeTarget]: { icon: ArrowUpIcon, class: 'bg-success-text/15 text-success-text' },
  [TRACKER_LIMIT_KINDS.incomeCap]: { icon: ArrowUpToLineIcon, class: 'bg-warning-text/15 text-warning-text' },
};
const items = computed(() => kinds.map((value) => ({ value, label: t(`budgets.limitKind.kinds.${value}.label`) })));
</script>

<template>
  <div class="grid gap-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-sm font-medium">{{ $t('budgets.limitKind.label') }}</span>
      <Popover>
        <PopoverTrigger as-child>
          <Button type="button" variant="ghost-primary" size="sm" class="gap-1.5">
            <CircleHelpIcon class="size-4" />
            {{ $t('budgets.limitKind.whatToChoose') }}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" class="grid w-96 max-w-[calc(100vw-2rem)] gap-4">
          <p class="font-semibold">{{ $t('budgets.limitKind.guideTitle') }}</p>
          <div v-for="value in kinds" :key="value" class="flex gap-3">
            <span :class="['flex size-7 shrink-0 items-center justify-center rounded-md', KIND_ICONS[value].class]">
              <component :is="KIND_ICONS[value].icon" class="size-4" />
            </span>
            <div class="grid gap-0.5">
              <span class="text-sm font-semibold">{{ $t(`budgets.limitKind.kinds.${value}.label`) }}</span>
              <span class="text-muted-foreground text-sm">{{ $t(`budgets.limitKind.kinds.${value}.guide`) }}</span>
            </div>
          </div>
          <i18n-t keypath="budgets.limitKind.goalNote" tag="p" class="text-muted-foreground border-t pt-3 text-xs">
            <template #goalLink>
              <RouterLink
                :to="{ name: ROUTES_NAMES.goals }"
                class="text-primary-text hover:text-primary-text/80 underline underline-offset-2"
              >
                {{ $t('budgets.limitKind.goalLink') }}
              </RouterLink>
            </template>
          </i18n-t>
        </PopoverContent>
      </Popover>
    </div>
    <PillTabs
      :model-value="kind"
      :items="items"
      :disabled="disabled"
      full-width
      @update:model-value="(value) => (kind = value as TRACKER_LIMIT_KINDS)"
    />
    <Callout variant="info">{{ $t(`budgets.limitKind.kinds.${kind}.hint`) }}</Callout>
  </div>
</template>

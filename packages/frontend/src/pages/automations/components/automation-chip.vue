<script setup lang="ts">
import { getMonogramTextColor } from '@/common/utils/monogram-color';
import AccountLogo from '@/components/common/account-logo.vue';
import BankConnectionLogo from '@/components/common/bank-connection-logo.vue';
import BrandLogo from '@/components/common/brand-logo.vue';
import { toEntityLogoDisplayProps } from '@/components/common/logo-selection';
import CategoryCircle from '@/components/common/category-circle.vue';
import TagIcon from '@/components/common/icons/tag-icon.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  CalendarIcon,
  CircleAlertIcon,
  CoinsIcon,
  FileTextIcon,
  LandmarkIcon,
  LayersIcon,
  StoreIcon,
} from '@lucide/vue';
import { computed } from 'vue';

import type { AutomationChip, AutomationDensity } from './automation-chips';
import { injectAutomationRefs } from './automation-refs';

const VISIBLE_KEYWORDS: Record<AutomationDensity, number> = {
  comfortable: 2,
  compact: 1,
};

const props = defineProps<{
  chip: AutomationChip;
  variant: 'when' | 'then';
  density: AutomationDensity;
}>();

const { refVisual, isReady } = injectAutomationRefs();

const visual = computed(() =>
  props.chip.kind === 'ref' ? refVisual({ type: props.chip.refType, id: props.chip.id }) : undefined,
);

const isMissingRef = computed(() => props.chip.kind === 'ref' && !visual.value && isReady.value);
const isPendingRef = computed(() => props.chip.kind === 'ref' && !visual.value && !isReady.value);

const isAvatarOnly = computed(() => props.density === 'compact' && props.chip.kind === 'ref');

const toneClass = computed(() => {
  const tone = props.chip.kind === 'amount' || props.chip.kind === 'transactionType' ? props.chip.tone : 'neutral';

  if (tone === 'income') return 'text-app-income-color border-app-income-color/30';
  if (tone === 'expense') return 'text-app-expense-color border-app-expense-color/30';
  return null;
});

const chipClass = computed(() =>
  cn(
    'inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap',
    props.variant === 'when' ? 'bg-card border-border' : 'bg-primary/10 border-primary/25',
    toneClass.value,
    isMissingRef.value && 'border-dashed',
    isAvatarOnly.value && 'px-1',
  ),
);

const iconClass = computed(() => cn('size-3.5 shrink-0', props.variant === 'then' && 'text-primary-text'));

const amountIcon = computed(() => {
  const tone = props.chip.kind === 'amount' || props.chip.kind === 'transactionType' ? props.chip.tone : 'neutral';

  if (tone === 'income') return ArrowUpRightIcon;
  if (tone === 'expense') return ArrowDownLeftIcon;
  return CoinsIcon;
});

const visibleKeywords = computed(() =>
  props.chip.kind === 'text' ? props.chip.keywords.slice(0, VISIBLE_KEYWORDS[props.density]) : [],
);

const hiddenKeywordsCount = computed(() =>
  props.chip.kind === 'text' ? props.chip.keywords.length - visibleKeywords.value.length : 0,
);

const tagStyle = computed(() => {
  if (visual.value?.type !== 'tag') return undefined;

  return {
    backgroundColor: visual.value.tag.color,
    color: getMonogramTextColor({ hex: visual.value.tag.color }),
  };
});
</script>

<template>
  <span v-if="isPendingRef" class="bg-muted h-6 w-20 shrink-0 animate-pulse rounded-md" />

  <span v-else :class="chipClass">
    <template v-if="chip.kind === 'amount'">
      <component :is="amountIcon" :class="iconClass" />
      <span class="font-mono tabular-nums">{{ chip.value }}</span>
      <span class="text-muted-foreground font-normal">
        {{ 'code' in chip.currency ? chip.currency.code : $t(chip.currency.key) }}
      </span>
    </template>

    <template v-else-if="chip.kind === 'transactionType'">
      <component :is="amountIcon" :class="iconClass" />
      <span class="capitalize">{{ $t(chip.labelKey) }}</span>
    </template>

    <template v-else-if="chip.kind === 'text'">
      <StoreIcon v-if="chip.field === 'merchant'" :class="iconClass" />
      <FileTextIcon v-else :class="iconClass" />
      <span class="text-muted-foreground font-normal">{{ $t(chip.labelKey) }}</span>
      <DesktopOnlyTooltip v-if="chip.keywords.length" :content="chip.keywords.join(', ')">
        <span class="flex items-center gap-1">
          <span class="max-w-[18ch] truncate">{{ visibleKeywords.join(', ') }}</span>
          <span v-if="hiddenKeywordsCount" class="text-muted-foreground font-normal"> +{{ hiddenKeywordsCount }} </span>
        </span>
      </DesktopOnlyTooltip>
    </template>

    <template v-else-if="chip.kind === 'dayOfMonth'">
      <CalendarIcon :class="iconClass" />
      <span class="text-muted-foreground font-normal">{{ $t('automations.chips.day') }}</span>
      <span class="font-mono tabular-nums">{{ chip.value }}</span>
    </template>

    <template v-else-if="chip.kind === 'note'">
      <FileTextIcon :class="iconClass" />
      <span class="text-muted-foreground font-normal">{{ $t(chip.labelKey) }}</span>
      <DesktopOnlyTooltip :content="chip.value" only-when-truncated>
        <span class="max-w-[24ch] truncate">&ldquo;{{ chip.value }}&rdquo;</span>
      </DesktopOnlyTooltip>
    </template>

    <template v-else-if="isMissingRef">
      <CircleAlertIcon :class="iconClass" />
      <span class="text-muted-foreground font-normal">{{ $t('automations.summary.missingRef') }}</span>
    </template>

    <template v-else-if="visual">
      <span v-if="chip.kind === 'ref' && chip.negated" class="text-muted-foreground font-normal">
        {{ $t('automations.chips.not') }}
      </span>

      <DesktopOnlyTooltip :content="visual.name" :disabled="!isAvatarOnly">
        <span class="flex min-w-0 items-center gap-1.5">
          <AccountLogo v-if="visual.type === 'account'" :account="visual.account" class="size-4" />
          <BrandLogo
            v-else-if="visual.type === 'payee'"
            v-bind="toEntityLogoDisplayProps(visual.payee)"
            :name="visual.payee.name"
            class="size-4 rounded-full"
          />
          <span
            v-else-if="visual.type === 'category'"
            class="flex size-4 shrink-0 items-center justify-center [&_svg]:size-3 [&>div]:size-4"
          >
            <CategoryCircle :category-id="visual.categoryId" />
          </span>
          <span
            v-else-if="visual.type === 'tag'"
            class="flex size-4 shrink-0 items-center justify-center rounded-full"
            :style="tagStyle"
          >
            <TagIcon v-if="visual.tag.icon" :name="visual.tag.icon" class="size-3" />
          </span>
          <LayersIcon v-else-if="visual.type === 'accountGroup'" :class="iconClass" />
          <BankConnectionLogo v-else :connection-id="visual.connectionId" :alt="visual.name" size="size-4">
            <template #fallback>
              <LandmarkIcon :class="iconClass" />
            </template>
          </BankConnectionLogo>

          <span v-if="!isAvatarOnly" class="max-w-[18ch] truncate">{{ visual.name }}</span>
        </span>
      </DesktopOnlyTooltip>
    </template>
  </span>
</template>

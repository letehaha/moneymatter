<template>
  <ResponsivePopover :title="$t('settings.ai.modelGuide.trigger')" align="end" content-class="w-80 p-3.5">
    <template #trigger>
      <Button variant="soft-primary" size="sm" class="h-6 gap-1 rounded-full px-2.5 text-xs">
        <LightbulbIcon class="size-3" />
        {{ $t('settings.ai.modelGuide.trigger') }}
      </Button>
    </template>

    <div class="flex flex-col gap-3 text-xs">
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <BrainIcon :class="cn('size-4.5 shrink-0', tier.textClass)" />
          <i18n-t keypath="settings.ai.modelGuide.tierHeading" tag="span" class="text-muted-foreground text-sm">
            <template #tier>
              <span :class="cn('font-bold', tier.textClass)">{{ $t(tier.labelKey) }}</span>
            </template>
          </i18n-t>
        </div>
        <div class="flex gap-1">
          <div v-for="(item, index) in TIERS" :key="item.id" class="flex flex-1 flex-col gap-1.5">
            <div :class="cn('h-1.5 rounded-full', index <= tierIndex ? item.barClass : 'bg-muted')" />
            <span
              :class="
                cn('text-[10.5px]', index === tierIndex ? cn('font-bold', item.textClass) : 'text-muted-foreground')
              "
            >
              {{ $t(item.labelKey) }}
            </span>
          </div>
        </div>
      </div>

      <p class="text-muted-foreground leading-relaxed">{{ $t(guide.whyKey) }}</p>

      <div class="flex flex-col gap-1.5">
        <span :class="SECTION_LABEL_CLASS">{{ $t('settings.ai.modelGuide.needsLabel') }}</span>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="need in guide.needs"
            :key="need"
            :class="
              cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium',
                NEEDS[need].required ? 'border-warning/45 bg-warning/10 text-warning-text' : 'bg-muted',
              )
            "
          >
            <component :is="NEEDS[need].icon" class="size-3" />
            {{ $t(NEEDS[need].labelKey) }}
          </span>
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <span :class="SECTION_LABEL_CLASS">{{ $t('settings.ai.modelGuide.picksLabel') }}</span>
        <span class="text-[12.5px] font-medium">{{ $t(guide.picksKey) }}</span>
      </div>

      <template v-if="fit">
        <div :class="cn('bg-muted/40 flex flex-col gap-2 rounded-md border p-2.5', hasGaps && 'border-warning/40')">
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between gap-2">
              <span :class="SECTION_LABEL_CLASS">{{ $t('settings.ai.modelGuide.yourModel') }}</span>
              <span :class="cn('shrink-0 rounded-full px-1.5 text-[10.5px] font-semibold', verdict.class)">
                {{ verdict.label }}
              </span>
            </div>
            <span class="font-mono text-[11.5px] break-all">{{ modelName }}</span>
          </div>

          <div v-if="fit.verdict === 'unknown'" class="flex items-start gap-2">
            <CircleHelpIcon class="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
            <div class="flex flex-col gap-0.5">
              <span class="font-semibold">{{ $t('settings.ai.modelGuide.unknown.title') }}</span>
              <span class="text-muted-foreground leading-relaxed">{{
                $t('settings.ai.modelGuide.unknown.detail')
              }}</span>
            </div>
          </div>

          <template v-else>
            <div v-for="check in checks" :key="check.kind" class="flex items-start gap-2">
              <CheckIcon v-if="check.ok" class="text-success-text mt-0.5 size-3.5 shrink-0" />
              <XIcon v-else class="text-destructive-text mt-0.5 size-3.5 shrink-0" />
              <div class="flex flex-col gap-0.5">
                <span class="font-semibold">{{ $t(CHECKS[check.kind].labelKey) }}</span>
                <span v-if="check.detail" class="text-muted-foreground leading-relaxed">{{ check.detail }}</span>
              </div>
            </div>
          </template>
        </div>

        <span v-if="fit.verdict !== 'unknown'" class="text-muted-foreground text-[10.5px]">
          {{ $t('settings.ai.modelGuide.source') }}
        </span>
      </template>
    </div>
  </ResponsivePopover>
</template>

<script setup lang="ts">
import { type AIModelNeed, type AIModelTier, getAIFeatureDisplayInfo } from '@/common/const';
import ResponsivePopover from '@/components/common/responsive-popover.vue';
import { Button } from '@/components/lib/ui/button';
import { cn } from '@/lib/utils';
import { AIFeatureStatus, getModelNameFromModelId } from '@bt/shared/types';
import {
  AlignLeftIcon,
  BracesIcon,
  BrainIcon,
  CheckIcon,
  CircleHelpIcon,
  ImageIcon,
  LightbulbIcon,
  TypeIcon,
  XIcon,
  ZapIcon,
} from '@lucide/vue';
import { type Component, computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { ModelFit, ModelFitCheckKind } from './model-fit';

const props = defineProps<{
  featureStatus: AIFeatureStatus;
  /** Null hides the model check, for anything but the user's own connection */
  fit: ModelFit | null;
}>();

const { t, locale } = useI18n();

const SECTION_LABEL_CLASS = 'text-muted-foreground text-[10.5px] font-semibold tracking-wider uppercase';

const TIERS: { id: AIModelTier; labelKey: string; textClass: string; barClass: string }[] = [
  {
    id: 'light',
    labelKey: 'settings.ai.modelGuide.tiers.light',
    textClass: 'text-success-text',
    barClass: 'bg-success-text',
  },
  {
    id: 'balanced',
    labelKey: 'settings.ai.modelGuide.tiers.balanced',
    textClass: 'text-warning-text',
    barClass: 'bg-warning-text',
  },
  {
    id: 'smart',
    labelKey: 'settings.ai.modelGuide.tiers.smart',
    textClass: 'text-primary-text',
    barClass: 'bg-primary-text',
  },
];

const NEEDS: Record<AIModelNeed, { icon: Component; labelKey: string; required?: boolean }> = {
  textOnly: { icon: TypeIcon, labelKey: 'settings.ai.modelGuide.needs.textOnly' },
  runsOften: { icon: ZapIcon, labelKey: 'settings.ai.modelGuide.needs.runsOften' },
  longAnswers: { icon: AlignLeftIcon, labelKey: 'settings.ai.modelGuide.needs.longAnswers' },
  readsFiles: { icon: ImageIcon, labelKey: 'settings.ai.modelGuide.needs.readsFiles', required: true },
  structuredAnswers: { icon: BracesIcon, labelKey: 'settings.ai.modelGuide.needs.structuredAnswers' },
};

/** An `okKey` detail is shown when the check passes too; every detail may read `{tokens}`. */
const CHECKS: Record<ModelFitCheckKind, { labelKey: string; failKey: string; okKey?: string }> = {
  readsText: {
    labelKey: 'settings.ai.modelGuide.checks.readsText.label',
    failKey: 'settings.ai.modelGuide.checks.readsText.fail',
  },
  readsImages: {
    labelKey: 'settings.ai.modelGuide.checks.readsImages.label',
    failKey: 'settings.ai.modelGuide.checks.readsImages.fail',
  },
  readsPdfs: {
    labelKey: 'settings.ai.modelGuide.checks.readsPdfs.label',
    failKey: 'settings.ai.modelGuide.checks.readsPdfs.fail',
  },
  longAnswers: {
    labelKey: 'settings.ai.modelGuide.checks.longAnswers.label',
    failKey: 'settings.ai.modelGuide.checks.longAnswers.fail',
    okKey: 'settings.ai.modelGuide.checks.longAnswers.ok',
  },
  structuredAnswers: {
    labelKey: 'settings.ai.modelGuide.checks.structuredAnswers.label',
    failKey: 'settings.ai.modelGuide.checks.structuredAnswers.fail',
  },
};

const guide = computed(() => getAIFeatureDisplayInfo({ feature: props.featureStatus.feature }).modelGuide);
const tierIndex = computed(() => TIERS.findIndex((item) => item.id === guide.value.tier));
const tier = computed(() => TIERS[tierIndex.value]!);
const modelName = computed(() => getModelNameFromModelId({ modelId: props.featureStatus.modelId }));
const hasGaps = computed(() => props.fit?.verdict === 'gaps');

const verdict = computed(() => {
  const fit = props.fit;
  if (fit?.verdict === 'fit') {
    return { label: t('settings.ai.modelGuide.verdict.fit'), class: 'bg-success-text/12 text-success-text' };
  }
  if (fit?.verdict === 'gaps') {
    const count = fit.checks.filter((check) => !check.ok).length;
    return {
      label: t('settings.ai.modelGuide.verdict.gaps', { count }, count),
      class: 'bg-warning/12 text-warning-text',
    };
  }
  return { label: t('settings.ai.modelGuide.verdict.unknown'), class: 'bg-muted text-muted-foreground' };
});

const checks = computed(() => {
  if (!props.fit || props.fit.verdict === 'unknown') return [];

  const tokens = new Intl.NumberFormat(locale.value, { notation: 'compact' }).format(
    props.featureStatus.capabilities?.maxOutputTokens ?? 0,
  );

  return props.fit.checks.map((check) => {
    const detailKey = check.ok ? CHECKS[check.kind].okKey : CHECKS[check.kind].failKey;
    return { ...check, detail: detailKey ? t(detailKey, { tokens }) : '' };
  });
});
</script>

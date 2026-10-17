<template>
  <div class="space-y-4">
    <!-- Token-based processing time warning -->
    <Callout v-if="tokenWarningLevel" :variant="tokenCalloutVariant" :title="tokenWarningTitle">
      <p class="opacity-90">{{ tokenWarningDescription }}</p>
    </Callout>
  </div>
</template>

<script setup lang="ts">
import { Callout } from '@/components/lib/ui/callout';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  estimatedInputTokens: number;
}>();

const { t } = useI18n();

// Token warning thresholds (input tokens)
const TOKEN_THRESHOLDS = {
  MEDIUM: 30_000,
  HIGH: 60_000,
  EXTREME: 100_000,
} as const;

type TokenWarningLevel = 'medium' | 'high' | 'extreme' | null;

const tokenWarningLevel = computed<TokenWarningLevel>(() => {
  const tokens = props.estimatedInputTokens;

  if (tokens >= TOKEN_THRESHOLDS.EXTREME) return 'extreme';
  if (tokens >= TOKEN_THRESHOLDS.HIGH) return 'high';
  if (tokens >= TOKEN_THRESHOLDS.MEDIUM) return 'medium';
  return null;
});

const tokenCalloutVariant = computed<'warning' | 'destructive'>(() =>
  tokenWarningLevel.value === 'high' || tokenWarningLevel.value === 'extreme' ? 'destructive' : 'warning',
);

const tokenWarningTitle = computed(() => {
  switch (tokenWarningLevel.value) {
    case 'extreme':
      return t('pages.statementParser.uploadExtract.tokenWarning.extreme.title');
    case 'high':
      return t('pages.statementParser.uploadExtract.tokenWarning.high.title');
    case 'medium':
      return t('pages.statementParser.uploadExtract.tokenWarning.medium.title');
    default:
      return '';
  }
});

const tokenWarningDescription = computed(() => {
  switch (tokenWarningLevel.value) {
    case 'extreme':
      return t('pages.statementParser.uploadExtract.tokenWarning.extreme.description');
    case 'high':
      return t('pages.statementParser.uploadExtract.tokenWarning.high.description');
    case 'medium':
      return t('pages.statementParser.uploadExtract.tokenWarning.medium.description');
    default:
      return '';
  }
});
</script>

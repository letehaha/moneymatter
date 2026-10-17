import { useAiSettings } from '@/composable/data-queries/ai-settings';
import { useDateLocale } from '@/composable/use-date-locale';
import type { AI_FEATURE } from '@bt/shared/types';
import { parseISO } from 'date-fns';
import { computed } from 'vue';

export type AiAllowanceTone = 'ok' | 'warning' | 'danger';

export const AI_ALLOWANCE_TEXT_CLASS: Record<AiAllowanceTone, string> = {
  ok: 'text-foreground',
  warning: 'text-warning-text',
  danger: 'text-destructive-text',
};

const DANGER_PERCENT = 90;
const WARNING_PERCENT = 60;

export function useAiAllowance() {
  const { aiAllowance, getFeatureStatus } = useAiSettings();
  const { format } = useDateLocale();

  // Features answered by the user's own model never count toward the allowance.
  const isOnOwnModel = ({ feature }: { feature?: AI_FEATURE }) =>
    !!feature && !!getFeatureStatus(feature)?.usingUserKey;

  const showBadge = ({ feature }: { feature?: AI_FEATURE } = {}) =>
    !!aiAllowance.value && aiAllowance.value.state !== 'ok' && !isOnOwnModel({ feature });

  const isReached = ({ feature }: { feature?: AI_FEATURE } = {}) =>
    aiAllowance.value?.state === 'reached' && !isOnOwnModel({ feature });

  const usedPercent = computed(() => aiAllowance.value?.usedPercent ?? 0);

  // Colour only; copy and badge visibility follow the backend `state`.
  const tone = computed<AiAllowanceTone>(() => {
    if (aiAllowance.value?.state === 'reached' || usedPercent.value >= DANGER_PERCENT) return 'danger';
    return usedPercent.value >= WARNING_PERCENT ? 'warning' : 'ok';
  });

  // `resetsAt` is midnight UTC; formatting the instant would show the previous day west of UTC.
  const resetDate = computed(() =>
    aiAllowance.value ? format(parseISO(aiAllowance.value.resetsAt.slice(0, 10)), 'd MMMM') : '',
  );

  return { allowance: aiAllowance, usedPercent, tone, resetDate, showBadge, isReached };
}

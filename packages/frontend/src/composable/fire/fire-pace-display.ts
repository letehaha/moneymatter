import { formatDuration } from '@/js/helpers/format-duration';
import { CheckIcon, TrendingDownIcon, TrendingUpIcon, TriangleAlertIcon } from '@lucide/vue';
import type { Component } from 'vue';
import type { ComposerTranslation } from 'vue-i18n';

import type { FireChartPoint } from './build-fire-plan';
import type { FirePace, FirePaceVerdict } from './fire-pace';

export type FirePaceTone = 'success' | 'primary' | 'warning';
export type FireChangeTone = FirePaceTone | 'neutral';

const FLAT_CHANGE_PCT = 2;

export type FireChartPace = {
  forecast: FireChartPoint[];
  anchorDate: Date;
  anchorLabel: string;
  tone: FirePaceTone;
};

type ShownVerdict = Exclude<FirePaceVerdict, 'no-history'>;

const TONES: Record<ShownVerdict, FirePaceTone> = {
  ahead: 'success',
  'back-in-reach': 'success',
  'on-pace': 'primary',
  behind: 'warning',
  'off-track': 'warning',
};

const ICONS: Record<ShownVerdict, Component> = {
  ahead: TrendingUpIcon,
  'back-in-reach': TrendingUpIcon,
  'on-pace': CheckIcon,
  behind: TrendingDownIcon,
  'off-track': TriangleAlertIcon,
};

export const PACE_TONE_CLASS: Record<FireChangeTone, string> = {
  success: 'bg-success-text/10 text-success-text',
  primary: 'bg-primary/10 text-primary-text',
  warning: 'bg-warning-text/10 text-warning-text',
  neutral: 'bg-muted text-muted-foreground',
};

export const PACE_SWATCH_CLASS: Record<FirePaceTone, string> = {
  success: 'bg-success-text',
  primary: 'bg-primary',
  warning: 'bg-warning-text',
};

export const paceTone = ({ verdict }: { verdict: FirePaceVerdict }): FirePaceTone | null =>
  verdict === 'no-history' ? null : TONES[verdict];

export const pctChange = ({
  now,
  then,
  upIsGood,
}: {
  now: number | null;
  then: number | null;
  upIsGood: boolean;
}): { change: string | null; tone: FireChangeTone } => {
  if (now === null || then === null || then === 0) return { change: null, tone: 'neutral' };
  const pct = Math.round((now / then - 1) * 100);
  const tone = Math.abs(pct) < FLAT_CHANGE_PCT ? 'neutral' : pct > 0 === upIsGood ? 'success' : 'warning';
  return { change: `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`, tone };
};

export const paceChip = ({ pace, t }: { pace: FirePace; t: ComposerTranslation }) => {
  if (pace.verdict === 'no-history') return null;
  const duration = formatDuration({ months: Math.abs(pace.shiftMonths ?? 0), t });
  const labels: Record<ShownVerdict, string> = {
    ahead: t('common.fire.pace.ahead', { duration }),
    behind: t('common.fire.pace.behind', { duration }),
    'on-pace': t('common.fire.pace.onPace'),
    'back-in-reach': t('common.fire.pace.backInReach'),
    'off-track': t('common.fire.pace.offTrack'),
  };
  return { tone: TONES[pace.verdict], icon: ICONS[pace.verdict], label: labels[pace.verdict] };
};

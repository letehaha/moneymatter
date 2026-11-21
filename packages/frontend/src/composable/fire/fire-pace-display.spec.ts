import { describe, expect, it } from 'vitest';
import type { ComposerTranslation } from 'vue-i18n';

import type { FirePace, FirePaceVerdict } from './fire-pace';
import { paceChip, paceTone, pctChange } from './fire-pace-display';

const t = ((key: string) => key) as unknown as ComposerTranslation;

describe('pctChange', () => {
  it('has no change without a baseline', () => {
    expect(pctChange({ now: 10, then: 0, upIsGood: true })).toStrictEqual({ change: null, tone: 'neutral' });
    expect(pctChange({ now: 10, then: null, upIsGood: true })).toStrictEqual({ change: null, tone: 'neutral' });
    expect(pctChange({ now: null, then: 10, upIsGood: true })).toStrictEqual({ change: null, tone: 'neutral' });
  });

  it('stays neutral under the flat threshold', () => {
    expect(pctChange({ now: 101, then: 100, upIsGood: true })).toStrictEqual({ change: '+1%', tone: 'neutral' });
    expect(pctChange({ now: 100, then: 100, upIsGood: true })).toStrictEqual({ change: '0%', tone: 'neutral' });
  });

  it('signs the change and tones it by direction', () => {
    expect(pctChange({ now: 110, then: 100, upIsGood: true })).toStrictEqual({ change: '+10%', tone: 'success' });
    expect(pctChange({ now: 90, then: 100, upIsGood: true })).toStrictEqual({ change: '−10%', tone: 'warning' });
    expect(pctChange({ now: 110, then: 100, upIsGood: false })).toStrictEqual({ change: '+10%', tone: 'warning' });
    expect(pctChange({ now: 90, then: 100, upIsGood: false })).toStrictEqual({ change: '−10%', tone: 'success' });
  });
});

describe('paceTone / paceChip', () => {
  const paceWith = ({ verdict }: { verdict: FirePaceVerdict }) => ({ verdict, shiftMonths: -4 }) as FirePace;

  it('has no tone or chip without history', () => {
    expect(paceTone({ verdict: 'no-history' })).toBeNull();
    expect(paceChip({ pace: paceWith({ verdict: 'no-history' }), t })).toBeNull();
  });

  it('tones each verdict', () => {
    const expected: Record<Exclude<FirePaceVerdict, 'no-history'>, string> = {
      ahead: 'success',
      'back-in-reach': 'success',
      'on-pace': 'primary',
      behind: 'warning',
      'off-track': 'warning',
    };
    for (const [verdict, tone] of Object.entries(expected) as [FirePaceVerdict, string][]) {
      expect(paceTone({ verdict })).toBe(tone);
      expect(paceChip({ pace: paceWith({ verdict }), t })?.tone).toBe(tone);
    }
  });
});

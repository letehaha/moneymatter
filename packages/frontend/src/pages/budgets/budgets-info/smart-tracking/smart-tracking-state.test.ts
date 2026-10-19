import { type RecordId, TRACKER_AI_LIKELY_SCORE, type TrackerSuggestionsResponse } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import { getSmartTrackingStripState, getSuggestionConfidence, isScanActive } from './smart-tracking-state';

type Suggestions = Pick<TrackerSuggestionsResponse, 'pending' | 'scan'>;

const buildSuggestions = ({
  pendingCount = 0,
  scan = {},
}: {
  pendingCount?: number;
  scan?: Partial<Suggestions['scan']>;
} = {}): Suggestions => ({
  pending: Array.from({ length: pendingCount }, (_, index) => ({
    id: `s-${index}` as RecordId,
    score: 0.6,
    reason: 'reason',
    transaction: {} as Suggestions['pending'][number]['transaction'],
  })),
  scan: {
    status: 'idle',
    startedAt: null,
    lastScannedAt: null,
    pausedReason: null,
    ...scan,
  },
});

describe('getSmartTrackingStripState', () => {
  it('shows the tip while smart tracking is off, unless the tip is hidden', () => {
    expect(
      getSmartTrackingStripState({
        aiEnabled: false,
        tipHidden: false,
        suggestions: undefined,
      }),
    ).toBe('tip');
    expect(
      getSmartTrackingStripState({
        aiEnabled: false,
        tipHidden: true,
        suggestions: buildSuggestions(),
      }),
    ).toBe('hidden');
  });

  it('renders nothing until suggestions load', () => {
    expect(
      getSmartTrackingStripState({
        aiEnabled: true,
        tipHidden: false,
        suggestions: undefined,
      }),
    ).toBe('hidden');
  });

  it.each(['queued', 'running'] as const)('shows scanning for a %s scan, even with pending rows', (status) => {
    expect(
      getSmartTrackingStripState({
        aiEnabled: true,
        tipHidden: false,
        suggestions: buildSuggestions({ pendingCount: 2, scan: { status } }),
      }),
    ).toBe('scanning');
  });

  it('prefers pending rows over a paused scan', () => {
    expect(
      getSmartTrackingStripState({
        aiEnabled: true,
        tipHidden: false,
        suggestions: buildSuggestions({
          pendingCount: 1,
          scan: { pausedReason: 'allowance' },
        }),
      }),
    ).toBe('review');
  });

  it('hides the strip for an archived tracker, even with pending rows', () => {
    expect(
      getSmartTrackingStripState({
        aiEnabled: true,
        tipHidden: false,
        suggestions: buildSuggestions({ pendingCount: 2, scan: { pausedReason: 'archived' } }),
      }),
    ).toBe('hidden');
  });

  it.each([
    ['plan', 'pausedPlan'],
    ['allowance', 'pausedAllowance'],
    ['unavailable', 'pausedUnavailable'],
    ['ended', 'ended'],
    ['no_start_date', 'noStartDate'],
    [null, 'idle'],
  ] as const)('maps paused reason %s to %s', (pausedReason, state) => {
    expect(
      getSmartTrackingStripState({
        aiEnabled: true,
        tipHidden: true,
        suggestions: buildSuggestions({ scan: { pausedReason } }),
      }),
    ).toBe(state);
  });
});

describe('getSuggestionConfidence', () => {
  it('reads as likely from the likely score up, possible below it', () => {
    expect(getSuggestionConfidence({ score: TRACKER_AI_LIKELY_SCORE })).toBe('likely');
    expect(getSuggestionConfidence({ score: 0.95 })).toBe('likely');
    expect(getSuggestionConfidence({ score: TRACKER_AI_LIKELY_SCORE - 0.01 })).toBe('possible');
  });
});

describe('isScanActive', () => {
  it('is true only for queued and running scans', () => {
    expect(isScanActive({ status: 'queued' })).toBe(true);
    expect(isScanActive({ status: 'running' })).toBe(true);
    expect(isScanActive({ status: 'idle' })).toBe(false);
    expect(isScanActive({ status: undefined })).toBe(false);
  });
});

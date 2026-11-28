import { describe, expect, it } from 'vitest';
import { computed, ref } from 'vue';

import { useSpikeDetection, SPIKE_DEFAULTS } from './use-spike-detection';

const makeChartData = (values: number[]) => computed(() => values.map((value, i) => ({ date: i + 1, value })));

describe('useSpikeDetection', () => {
  describe('default behavior (no options)', () => {
    it('returns empty array for a single point without a baseline', () => {
      const { spikePoints } = useSpikeDetection({ chartData: makeChartData([100]) });
      expect(spikePoints.value).toEqual([]);
    });

    it('returns empty array for empty data', () => {
      const { spikePoints } = useSpikeDetection({ chartData: makeChartData([]) });
      expect(spikePoints.value).toEqual([]);
    });

    it('detects spike when percent change exceeds default threshold', () => {
      // 1000 -> 1050 = 5% change (> default 3%), absolute = 50 (< default 500)
      // With OR logic, percent alone triggers a spike
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([1000, 1050]),
      });

      expect(spikePoints.value).toHaveLength(1);
      expect(spikePoints.value[0]).toMatchObject({
        date: 2,
        value: 1050,
        deltaAbsolute: 50,
        isPositive: true,
      });
    });

    it('detects spike when absolute change exceeds default threshold', () => {
      // 10000 -> 10501 = ~5% change but absolute = 501 (> default 500)
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([10000, 10501]),
      });

      expect(spikePoints.value).toHaveLength(1);
    });

    it('does not detect spike when neither threshold is exceeded', () => {
      // 10000 -> 10200 = 2% change (< 3%) and absolute = 200 (< 500)
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([10000, 10200]),
      });

      expect(spikePoints.value).toHaveLength(0);
    });

    it('detects negative spikes', () => {
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([1000, 900]),
      });

      expect(spikePoints.value).toHaveLength(1);
      expect(spikePoints.value[0]).toMatchObject({
        isPositive: false,
        deltaAbsolute: -100,
      });
    });
  });

  describe('baseline option', () => {
    it('detects a spike on the first point against the baseline', () => {
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([5000, 5000]),
        baseline: computed(() => 10000),
      });

      expect(spikePoints.value).toHaveLength(1);
      expect(spikePoints.value[0]).toMatchObject({
        date: 1,
        value: 5000,
        deltaAbsolute: -5000,
        deltaPercent: -50,
        isPositive: false,
      });
    });

    it('detects a spike when the period has a single point', () => {
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([5000]),
        baseline: computed(() => 10000),
      });

      expect(spikePoints.value).toHaveLength(1);
      expect(spikePoints.value[0]).toMatchObject({ date: 1, deltaAbsolute: -5000 });
    });

    it('skips the first point when the baseline is null', () => {
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([5000, 5000]),
        baseline: computed(() => null),
      });

      expect(spikePoints.value).toEqual([]);
    });
  });

  describe('enabled option', () => {
    it('returns empty array when disabled', () => {
      const options = computed(() => ({ enabled: false }));
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([100, 1000, 50]),
        options,
      });

      expect(spikePoints.value).toEqual([]);
    });

    it('detects spikes when explicitly enabled', () => {
      const options = computed(() => ({ enabled: true }));
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([100, 1000]),
        options,
      });

      expect(spikePoints.value).toHaveLength(1);
    });
  });

  describe('custom thresholds', () => {
    it('uses custom percentThreshold', () => {
      // 1000 -> 1040 = 4% change. Default threshold (3%) would detect it.
      // Setting threshold to 5% should NOT detect it.
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([1000, 1040]),
        options: computed(() => ({
          percentThreshold: 5,
          // Set absoluteThreshold high so only percent matters
          absoluteThreshold: 10000,
        })),
      });

      expect(spikePoints.value).toHaveLength(0);
    });

    it('uses custom absoluteThreshold', () => {
      // 10000 -> 10300 = 3% change and absolute = 300
      // percentThreshold high (won't trigger), absoluteThreshold = 200 (will trigger)
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([10000, 10300]),
        options: computed(() => ({
          percentThreshold: 50,
          absoluteThreshold: 200,
        })),
      });

      expect(spikePoints.value).toHaveLength(1);
    });

    it('clamps percentThreshold to minimum of 1', () => {
      // Passing 0 should be clamped to 1
      const options = computed(() => ({ percentThreshold: 0, absoluteThreshold: 10000 }));
      // 1000 -> 1005 = 0.5% change — should NOT trigger with threshold clamped to 1
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([1000, 1005]),
        options,
      });

      expect(spikePoints.value).toHaveLength(0);
    });

    it('clamps absoluteThreshold to minimum of 1', () => {
      const options = computed(() => ({ absoluteThreshold: 0, percentThreshold: 50 }));
      // 1000 -> 1002 = absolute 2 > 1 (clamped), so detected
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([1000, 1002]),
        options,
      });

      expect(spikePoints.value).toHaveLength(1);
    });
  });

  describe('maxSpikes option', () => {
    it('caps results to default maxSpikes', () => {
      // Create data with many spikes (alternating high and low)
      const values = [100];
      for (let i = 0; i < 15; i++) {
        values.push(i % 2 === 0 ? 10000 : 100);
      }

      const { spikePoints } = useSpikeDetection({ chartData: makeChartData(values) });

      expect(spikePoints.value.length).toBeLessThanOrEqual(SPIKE_DEFAULTS.maxSpikes);
      expect(spikePoints.value).toHaveLength(SPIKE_DEFAULTS.maxSpikes);
    });

    it('caps results to custom maxSpikes', () => {
      const values = [100, 10000, 100, 10000, 100, 10000];

      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData(values),
        options: computed(() => ({ maxSpikes: 2 })),
      });

      expect(spikePoints.value).toHaveLength(2);
    });

    it('clamps maxSpikes to minimum of 1', () => {
      const values = [100, 10000, 100, 10000];

      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData(values),
        options: computed(() => ({ maxSpikes: 0 })),
      });

      // Clamped to 1, so should return exactly 1 spike
      expect(spikePoints.value).toHaveLength(1);
    });
  });

  describe('OR condition logic', () => {
    it('detects spike when only percent threshold exceeded (not absolute)', () => {
      // 100 -> 110 = 10% change (> 3%) but absolute = 10 (< 500)
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([100, 110]),
      });

      expect(spikePoints.value).toHaveLength(1);
    });

    it('detects spike when only absolute threshold exceeded (not percent)', () => {
      // 100000 -> 100501 = 0.5% change (< 3%) but absolute = 501 (> 500)
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([100000, 100501]),
      });

      expect(spikePoints.value).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('handles zero previous value (uses 100% as deltaPercent)', () => {
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([0, 1000]),
      });

      expect(spikePoints.value).toHaveLength(1);
      expect(spikePoints.value[0]).toMatchObject({
        deltaPercent: 100,
        deltaAbsolute: 1000,
      });
    });

    it('returns 0 deltaPercent when both values are 0', () => {
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([0, 0]),
      });

      expect(spikePoints.value).toHaveLength(0);
    });

    it('sorts spikes by absolute percent change descending', () => {
      // Three spikes with different magnitudes
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([1000, 1050, 1000, 1200]),
        options: computed(() => ({ percentThreshold: 1, absoluteThreshold: 10000 })),
      });

      // 1050->1000 = ~-4.76%, 1000->1200 = 20%, 1000->1050 = 5%
      expect(spikePoints.value.length).toBeGreaterThan(1);
      for (let i = 1; i < spikePoints.value.length; i++) {
        expect(Math.abs(spikePoints.value[i - 1]!.deltaPercent)).toBeGreaterThanOrEqual(
          Math.abs(spikePoints.value[i]!.deltaPercent),
        );
      }
    });

    it('is reactive to options changes', () => {
      const enabled = ref(true);
      const options = computed(() => ({ enabled: enabled.value }));
      const { spikePoints } = useSpikeDetection({
        chartData: makeChartData([100, 1000]),
        options,
      });

      expect(spikePoints.value).toHaveLength(1);

      enabled.value = false;
      expect(spikePoints.value).toHaveLength(0);
    });
  });
});

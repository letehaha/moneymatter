import { type ComputedRef, computed } from 'vue';

export interface SpikePoint {
  date: number;
  value: number;
  deltaAbsolute: number;
  deltaPercent: number;
  isPositive: boolean;
}

export interface SpikeDetectionOptions {
  enabled?: boolean;
  percentThreshold?: number;
  absoluteThreshold?: number;
  maxSpikes?: number;
}

export const SPIKE_DEFAULTS = {
  enabled: true,
  percentThreshold: 3,
  absoluteThreshold: 500,
  maxSpikes: 10,
} as const;

export function useSpikeDetection({
  chartData,
  baseline,
  options,
}: {
  chartData: ComputedRef<{ date: number; value: number }[]>;
  /** Value right before the first point, so the first point can be a spike too. */
  baseline?: ComputedRef<number | null>;
  options?: ComputedRef<SpikeDetectionOptions>;
}): {
  spikePoints: ComputedRef<SpikePoint[]>;
} {
  const spikePoints = computed<SpikePoint[]>(() => {
    const opts = options?.value ?? {};
    const enabled = opts.enabled ?? SPIKE_DEFAULTS.enabled;
    if (!enabled) return [];

    const percentThreshold = Math.max(1, opts.percentThreshold ?? SPIKE_DEFAULTS.percentThreshold);
    const absoluteThreshold = Math.max(1, opts.absoluteThreshold ?? SPIKE_DEFAULTS.absoluteThreshold);
    const maxSpikes = Math.max(1, opts.maxSpikes ?? SPIKE_DEFAULTS.maxSpikes);

    const data = chartData.value;
    const baselineValue = baseline?.value ?? null;

    const candidates: SpikePoint[] = [];

    for (let i = 0; i < data.length; i++) {
      const prevValue = i === 0 ? baselineValue : data[i - 1]!.value;
      if (prevValue === null) continue;

      const curr = data[i]!;

      const deltaAbsolute = curr.value - prevValue;

      // Avoid division by zero — if previous value is 0, use absolute value as percent proxy
      let deltaPercent = 0;
      if (prevValue !== 0) {
        deltaPercent = (deltaAbsolute / Math.abs(prevValue)) * 100;
      } else if (deltaAbsolute !== 0) {
        deltaPercent = 100;
      }

      if (Math.abs(deltaPercent) > percentThreshold || Math.abs(deltaAbsolute) > absoluteThreshold) {
        candidates.push({
          date: curr.date,
          value: curr.value,
          deltaAbsolute,
          deltaPercent,
          isPositive: deltaAbsolute > 0,
        });
      }
    }

    // Sort by absolute percent change descending and cap at maxSpikes
    return [...candidates].sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent)).slice(0, maxSpikes);
  });

  return { spikePoints };
}

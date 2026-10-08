import { PLANNED_MATCH_WINDOW_DAYS } from '@bt/shared/types';
import { addDays, subDays } from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isPlanMatchWindowExpired, planExpiredDays } from './planned-transactions';

const NOW = new Date(2026, 7, 12, 10, 30);

describe('planned transaction match window', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isPlanMatchWindowExpired', () => {
    it('is false for a plan still inside the window', () => {
      expect(isPlanMatchWindowExpired({ time: subDays(NOW, PLANNED_MATCH_WINDOW_DAYS - 1) })).toBe(false);
    });

    it('is false for a future plan', () => {
      expect(isPlanMatchWindowExpired({ time: addDays(NOW, 3) })).toBe(false);
    });

    it('is false exactly at the window edge', () => {
      expect(isPlanMatchWindowExpired({ time: subDays(NOW, PLANNED_MATCH_WINDOW_DAYS) })).toBe(false);
    });

    it('is true one millisecond past the window edge', () => {
      const edge = subDays(NOW, PLANNED_MATCH_WINDOW_DAYS);
      expect(isPlanMatchWindowExpired({ time: new Date(edge.getTime() - 1) })).toBe(true);
    });

    it('is true well outside the window', () => {
      expect(isPlanMatchWindowExpired({ time: subDays(NOW, PLANNED_MATCH_WINDOW_DAYS + 5) })).toBe(true);
    });

    it('accepts an ISO string', () => {
      expect(isPlanMatchWindowExpired({ time: subDays(NOW, PLANNED_MATCH_WINDOW_DAYS + 1).toISOString() })).toBe(true);
    });
  });

  describe('planExpiredDays', () => {
    it('counts calendar days since the plan date', () => {
      expect(planExpiredDays({ time: subDays(NOW, 9) })).toBe(9);
    });

    it('returns 0 for a plan dated today', () => {
      expect(planExpiredDays({ time: NOW })).toBe(0);
    });

    it('returns a negative count for a future plan', () => {
      expect(planExpiredDays({ time: addDays(NOW, 2) })).toBe(-2);
    });

    it('accepts an ISO string', () => {
      expect(planExpiredDays({ time: subDays(NOW, 4).toISOString() })).toBe(4);
    });
  });
});

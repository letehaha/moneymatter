import { afterAll, describe, expect, it, jest } from '@jest/globals';

import { runSandboxedAnalysis, shutdownSandbox } from './run-sandboxed-analysis';

jest.setTimeout(30_000);

afterAll(async () => {
  await shutdownSandbox();
});

/** Runs `expression` in the guest and returns its value. */
const evaluate = async ({ expression, inputs = {} }: { expression: string; inputs?: Record<string, unknown> }) => {
  const result = await runSandboxedAnalysis({ code: `return { values: { result: ${expression} } };`, inputs });
  if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
  return result.output.values?.result;
};

const failure = async (expression: string) => {
  const result = await runSandboxedAnalysis({ code: `return { values: { result: ${expression} } };`, inputs: {} });
  if (result.ok) throw new Error('expected a failure');
  return result.error;
};

describe('guest helpers', () => {
  describe('sum, mean, median, percentile', () => {
    it('sums plain numbers, a property or a selector', async () => {
      expect(await evaluate({ expression: 'sum([1, 2, 3.5])' })).toBe(6.5);
      expect(await evaluate({ expression: 'sum([{ a: 1 }, { a: 2 }], "a")' })).toBe(3);
      expect(await evaluate({ expression: 'sum([{ a: 1 }, { a: 2 }], (row) => row.a * 10)' })).toBe(30);
      expect(await evaluate({ expression: 'sum([])' })).toBe(0);
    });

    it('averages, and gives null for no values', async () => {
      expect(await evaluate({ expression: 'mean([1, 2, 6])' })).toBe(3);
      expect(await evaluate({ expression: 'mean([])' })).toBeNull();
    });

    it('finds the median of an odd and an even count', async () => {
      expect(await evaluate({ expression: 'median([5, 1, 3])' })).toBe(3);
      expect(await evaluate({ expression: 'median([4, 1, 3, 2])' })).toBe(2.5);
      expect(await evaluate({ expression: 'median([])' })).toBeNull();
    });

    it('interpolates a percentile', async () => {
      expect(await evaluate({ expression: 'percentile([1, 2, 3, 4, 5], 0)' })).toBe(1);
      expect(await evaluate({ expression: 'percentile([1, 2, 3, 4, 5], 50)' })).toBe(3);
      expect(await evaluate({ expression: 'percentile([1, 2, 3, 4, 5], 100)' })).toBe(5);
      expect(await evaluate({ expression: 'percentile([10, 20], 25)' })).toBe(12.5);
      expect(await evaluate({ expression: 'percentile([{ a: 1 }, { a: 9 }], 50, "a")' })).toBe(5);
    });

    it('refuses values that are not finite numbers, naming the problem', async () => {
      expect((await failure('sum([1, "2"])')).message).toMatch(/finite number/);
      expect((await failure('sum([1, null])')).message).toMatch(/finite number/);
      expect((await failure('sum(5)')).message).toMatch(/array/);
      expect((await failure('percentile([1], 101)')).message).toMatch(/percentile/);
    });
  });

  describe('groupBy and sortBy', () => {
    it('groups by a property or a function, keeping first-seen key order', async () => {
      const rows = [
        { c: 'b', n: 1 },
        { c: 'a', n: 2 },
        { c: 'b', n: 3 },
      ];

      expect(await evaluate({ expression: 'groupBy(input.rows, "c")', inputs: { rows } })).toEqual({
        b: [rows[0], rows[2]],
        a: [rows[1]],
      });
      expect(
        await evaluate({
          expression: 'Object.keys(groupBy(input.rows, (r) => r.n % 2 ? "odd" : "even"))',
          inputs: { rows },
        }),
      ).toEqual(['odd', 'even']);
    });

    it('does not let a group key reach the prototype', async () => {
      const rows = [{ c: '__proto__' }, { c: 'constructor' }];

      const result = await evaluate({
        expression:
          '(() => { const g = groupBy(input.rows, "c"); return [Object.keys(g), Object.getPrototypeOf(g) === null]; })()',
        inputs: { rows },
      });

      expect(result).toEqual([['__proto__', 'constructor'], true]);
    });

    it('sorts a copy, stably, ascending or descending', async () => {
      const rows = [
        { k: 2, id: 'a' },
        { k: 1, id: 'b' },
        { k: 2, id: 'c' },
      ];

      expect(await evaluate({ expression: 'sortBy(input.rows, "k").map((r) => r.id)', inputs: { rows } })).toEqual([
        'b',
        'a',
        'c',
      ]);
      expect(
        await evaluate({ expression: 'sortBy(input.rows, "k", "desc").map((r) => r.id)', inputs: { rows } }),
      ).toEqual(['a', 'c', 'b']);
      expect(await evaluate({ expression: 'sortBy(["b", "a", "c"], (v) => v)' })).toEqual(['a', 'b', 'c']);
    });

    it('puts missing sort keys last', async () => {
      const rows = [{ k: null }, { k: 2 }, {}, { k: 1 }];

      expect(
        await evaluate({ expression: 'sortBy(input.rows, "k").map((r) => r.k ?? null)', inputs: { rows } }),
      ).toEqual([1, 2, null, null]);
    });
  });

  describe('movingAverage', () => {
    it('averages each full window and leaves the lead-in empty', async () => {
      expect(await evaluate({ expression: 'movingAverage([1, 2, 3, 4, 5], 3)' })).toEqual([null, null, 2, 3, 4]);
      expect(await evaluate({ expression: 'movingAverage([1, 2, 3], 1)' })).toEqual([1, 2, 3]);
      expect(await evaluate({ expression: 'movingAverage([{ v: 2 }, { v: 4 }], 2, "v")' })).toEqual([null, 3]);
    });

    it('refuses a bad window', async () => {
      expect((await failure('movingAverage([1], 0)')).message).toMatch(/window/);
      expect((await failure('movingAverage([1], 1.5)')).message).toMatch(/window/);
    });
  });

  describe('byMonth', () => {
    it('buckets by calendar month in order, summing a value', async () => {
      const rows = [
        { d: '2026-02-03', v: 7 },
        { d: '2026-01-15T10:00:00Z', v: 10 },
        { d: '2026-01-20', v: 5 },
      ];

      expect(
        await evaluate({
          expression: 'byMonth(input.rows, "d", "v").map(({ month, count, sum }) => ({ month, count, sum }))',
          inputs: { rows },
        }),
      ).toEqual([
        { month: '2026-01', count: 2, sum: 15 },
        { month: '2026-02', count: 1, sum: 7 },
      ]);
      expect(await evaluate({ expression: 'byMonth(input.rows, "d").map((m) => m.sum)', inputs: { rows } })).toEqual([
        null,
        null,
      ]);
      expect(await evaluate({ expression: 'byMonth(input.rows, "d")[0].items.length', inputs: { rows } })).toBe(2);
    });

    it('sums in minor units so the buckets add up exactly', async () => {
      const rows = [
        { d: '2026-01-01', v: 0.1 },
        { d: '2026-01-02', v: 0.2 },
      ];

      expect(await evaluate({ expression: 'byMonth(input.rows, "d", "v")[0].sum', inputs: { rows } })).toBe(0.3);
    });

    it('refuses a value that is not a date', async () => {
      expect((await failure('byMonth([{ d: "last week" }], "d")')).message).toMatch(/date/);
    });
  });

  describe('minor', () => {
    it('adds 0.1 and 0.2 to 0.3 at 2 decimals, where plain addition does not', async () => {
      expect(await evaluate({ expression: '0.1 + 0.2' })).toBe(0.30000000000000004);
      expect(await evaluate({ expression: 'minor.sum([0.1, 0.2], 2)' })).toBe(0.3);
    });

    it('rounds each value half away from zero before adding', async () => {
      expect(await evaluate({ expression: 'minor.sum([10.005, 20.005], 2)' })).toBe(30.02);
      expect(await evaluate({ expression: 'minor.sum([-10.005, -20.005], 2)' })).toBe(-30.02);
      expect(await evaluate({ expression: 'minor.sum([1.5, 2.5], 0)' })).toBe(5);
      expect(await evaluate({ expression: 'minor.sum([0.0005, 0.0005], 3)' })).toBe(0.002);
    });

    it('takes a property or a selector, and gives 0 for nothing', async () => {
      expect(await evaluate({ expression: 'minor.sum([{ a: 0.1 }, { a: 0.2 }], 2, "a")' })).toBe(0.3);
      expect(await evaluate({ expression: 'minor.sum([], 2)' })).toBe(0);
    });

    it('converts to and from minor units', async () => {
      expect(await evaluate({ expression: 'minor.toMinor(12.34, 2)' })).toBe(1234);
      expect(await evaluate({ expression: 'minor.toMinor(1e-7, 2)' })).toBe(0);
      expect(await evaluate({ expression: 'minor.fromMinor(1234, 2)' })).toBe(12.34);
    });

    it('refuses bad decimals and non-numbers', async () => {
      expect((await failure('minor.sum([1], -1)')).message).toMatch(/decimals/);
      expect((await failure('minor.sum([1], 2.5)')).message).toMatch(/decimals/);
      expect((await failure('minor.sum([1], 20)')).message).toMatch(/decimals/);
      expect((await failure('minor.sum(["1"], 2)')).message).toMatch(/finite number/);
    });
  });
});

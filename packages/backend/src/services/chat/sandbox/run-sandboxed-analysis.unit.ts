import { CHAT_SANDBOX_LIMITS } from '@bt/shared/types';
import { afterAll, describe, expect, it, jest } from '@jest/globals';

import { runSandboxedAnalysis, type SandboxResult, shutdownSandbox } from './run-sandboxed-analysis';
import { createSandboxPool } from './sandbox-pool';
import type { SandboxErrorKind } from './sandbox-protocol';

jest.setTimeout(30_000);

afterAll(async () => {
  await shutdownSandbox();
});

const run = ({ code, inputs = {} }: { code: string; inputs?: Record<string, unknown> }) =>
  runSandboxedAnalysis({ code, inputs });

const expectFailure = ({ result, kind }: { result: SandboxResult; kind: SandboxErrorKind }) => {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.error.kind).toBe(kind);
  return result.error;
};

const expectOk = (result: SandboxResult) => {
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`);
  return result.output;
};

describe('runSandboxedAnalysis round trips', () => {
  it('sums rows from the input', async () => {
    const result = await run({
      code: 'return { values: { total: sum(input.rows, "amount"), count: input.rows.length } };',
      inputs: { rows: [{ amount: 10.5 }, { amount: 4.5 }, { amount: 5 }] },
    });

    expect(expectOk(result)).toEqual({ values: { total: 20, count: 3 } });
  });

  it('groups rows and returns a table', async () => {
    const result = await run({
      code: `
        const groups = groupBy(input.rows, 'category');
        const rows = Object.keys(groups).map((category) => ({ category, total: minor.sum(groups[category], 2, 'amount') }));
        return {
          tables: {
            byCategory: {
              type: 'table',
              title: 'Spending by category',
              columns: [
                { key: 'category', label: 'Category', kind: 'text' },
                { key: 'total', label: 'Total', kind: 'money', currencyCode: 'USD' },
              ],
              rows: sortBy(rows, 'total', 'desc'),
            },
          },
        };
      `,
      inputs: {
        rows: [
          { category: 'Food', amount: 10.1 },
          { category: 'Food', amount: 20.2 },
          { category: 'Rent', amount: 500 },
        ],
      },
    });

    expect(expectOk(result)).toEqual({
      tables: {
        byCategory: {
          type: 'table',
          title: 'Spending by category',
          columns: [
            { key: 'category', label: 'Category', kind: 'text' },
            { key: 'total', label: 'Total', kind: 'money', currencyCode: 'USD' },
          ],
          rows: [
            { category: 'Rent', total: 500 },
            { category: 'Food', total: 30.3 },
          ],
        },
      },
    });
  });

  it('returns a chart spec', async () => {
    const result = await run({
      code: `
        const months = byMonth(input.rows, 'date', 'amount');
        return {
          charts: {
            monthly: {
              type: 'chart',
              kind: 'bar',
              title: 'Per month',
              unit: { kind: 'money', currencyCode: 'EUR' },
              xAxis: { type: 'category', values: months.map((m) => m.month) },
              series: [{ name: 'Spending', values: months.map((m) => m.sum) }],
            },
          },
          kpis: { headline: { type: 'kpis', items: [{ label: 'Total', value: sum(months, 'sum'), kind: 'money', currencyCode: 'EUR' }] } },
        };
      `,
      inputs: {
        rows: [
          { date: '2026-01-15', amount: 10 },
          { date: '2026-01-20', amount: 5 },
          { date: '2026-02-03', amount: 7 },
        ],
      },
    });

    const output = expectOk(result);
    expect(output.charts?.monthly).toMatchObject({
      xAxis: { values: ['2026-01', '2026-02'] },
      series: [{ name: 'Spending', values: [15, 7] }],
    });
    expect(output.kpis?.headline?.items[0]?.value).toBe(22);
  });

  it('handles a realistic number of rows', async () => {
    const rows = Array.from({ length: 5000 }, (_, index) => ({
      id: `0198f1a2-7b3c-7d4e-8f50-${String(index).padStart(12, '0')}`,
      date: `2026-0${(index % 9) + 1}-10`,
      amount: (index % 100) + 0.25,
      note: 'groceries and other things bought on the way home',
    }));

    const result = await run({
      code: 'return { values: { total: minor.sum(input.rows, 2, "amount"), months: byMonth(input.rows, "date", "amount").length } };',
      inputs: { rows },
    });

    expect(expectOk(result)).toEqual({
      values: { total: rows.reduce((acc, row) => acc + Math.round(row.amount * 100), 0) / 100, months: 9 },
    });
  });

  it('reports the duration', async () => {
    const result = await run({ code: 'return { values: {} };' });

    expect(result.ok).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('runSandboxedAnalysis errors the model can fix', () => {
  it('names a syntax error', async () => {
    const error = expectFailure({ result: await run({ code: 'return {' }), kind: 'syntax' });

    expect(error.message).toMatch(/syntax|unexpected/i);
  });

  it('names a runtime error and keeps its message', async () => {
    const thrown = expectFailure({
      result: await run({ code: 'throw new Error("boom: the rows are empty");' }),
      kind: 'runtime',
    });
    const nullAccess = expectFailure({ result: await run({ code: 'return input.missing.field;' }), kind: 'runtime' });

    expect(thrown.message).toContain('boom: the rows are empty');
    expect(nullAccess.message).toMatch(/undefined|null/);
  });

  it('refuses a thrown non-error', async () => {
    expectFailure({ result: await run({ code: 'throw 42;' }), kind: 'runtime' });
    expectFailure({ result: await run({ code: 'throw { toString() { throw 1; } };' }), kind: 'runtime' });
  });

  it('refuses async code', async () => {
    const error = expectFailure({
      result: await run({ code: 'return Promise.resolve({ values: {} });' }),
      kind: 'runtime',
    });

    expect(error.message).toMatch(/async|promise/i);
  });

  it('refuses a return of nothing, or of a non-finite number', async () => {
    expectFailure({ result: await run({ code: 'const x = 1;' }), kind: 'output' });
    expectFailure({ result: await run({ code: 'return { values: { ratio: 1 / 0 } };' }), kind: 'output' });
    expectFailure({ result: await run({ code: 'return { values: { ratio: 0 / 0 } };' }), kind: 'output' });
  });

  it('refuses code or input over their bounds', async () => {
    const longCode = `return { values: { note: "${'x'.repeat(CHAT_SANDBOX_LIMITS.codeBytes)}" } };`;
    const bigInput = { blob: 'x'.repeat(CHAT_SANDBOX_LIMITS.inputBytes + 1) };

    expectFailure({ result: await run({ code: longCode }), kind: 'input' });
    expectFailure({ result: await run({ code: 'return { values: {} };', inputs: bigInput }), kind: 'input' });
    expectFailure({ result: await run({ code: 'return { values: {} };', inputs: { n: BigInt(1) } }), kind: 'input' });
  });
});

describe('runSandboxedAnalysis limits', () => {
  it('stops an endless loop with a timeout inside the CPU budget', async () => {
    const startedAt = Date.now();

    const result = await run({ code: 'while (true) {}' });

    expectFailure({ result, kind: 'timeout' });
    expect(Date.now() - startedAt).toBeLessThan(CHAT_SANDBOX_LIMITS.wallMs);
  });

  it('cannot swallow the interrupt with try/catch', async () => {
    const startedAt = Date.now();

    const result = await run({ code: 'while (true) { try { for (;;) {} } catch (e) {} }' });

    expectFailure({ result, kind: 'timeout' });
    expect(Date.now() - startedAt).toBeLessThan(CHAT_SANDBOX_LIMITS.wallMs);
  });

  it('stops a loop that burns CPU inside a built-in', async () => {
    const result = await run({
      code: 'const big = "a".repeat(1000000); let n = 0; while (true) { n += big.indexOf("b"); }',
    });

    expectFailure({ result, kind: 'timeout' });
  });

  it('reports a 1 GB string as a memory error', async () => {
    expectFailure({
      result: await run({ code: 'const s = "x".repeat(1e9); return { values: { n: s.length } };' }),
      kind: 'memory',
    });
  });

  it('reports a 1 GB array as a memory error', async () => {
    expectFailure({
      result: await run({ code: 'const a = new Array(1e9).fill(0); return { values: { n: a.length } };' }),
      kind: 'memory',
    });
  });

  it('reports many large arrays that never reach an interpreter poll as a memory error', async () => {
    expectFailure({
      result: await run({
        code: 'const keep = []; for (let i = 0; i < 20; i++) keep.push(new Array(1e6).fill(0)); return { values: { n: keep.length } };',
      }),
      kind: 'memory',
    });
  });

  it('stops catastrophic regex backtracking inside the wall clock', async () => {
    const startedAt = Date.now();

    const result = await run({ code: 'return { values: { r: /(a+)+$/.test("a".repeat(40) + "b") } };' });

    expectFailure({ result, kind: 'timeout' });
    expect(Date.now() - startedAt).toBeLessThan(CHAT_SANDBOX_LIMITS.wallMs + 1_000);
  });

  it('reports a growing allocation as a memory error', async () => {
    expectFailure({
      result: await run({ code: 'const keep = []; while (true) keep.push(new Array(10000).fill(0));' }),
      kind: 'memory',
    });
  });

  it('cannot swallow a memory error and keep going past the CPU budget', async () => {
    const startedAt = Date.now();

    const result = await run({
      code: 'const keep = []; while (true) { try { keep.push(new Array(10000).fill(0)); } catch (e) {} }',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(['memory', 'timeout']).toContain(result.error.kind);
    expect(Date.now() - startedAt).toBeLessThan(CHAT_SANDBOX_LIMITS.wallMs);
  });

  it('cannot loop forever on allocation failures', async () => {
    const startedAt = Date.now();

    const result = await run({
      code: 'const keep = []; while (true) { try { keep.push(new Array(1e6).fill(0)); } catch (e) {} }',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(['memory', 'timeout']).toContain(result.error.kind);
    expect(Date.now() - startedAt).toBeLessThan(CHAT_SANDBOX_LIMITS.wallMs + 1_000);
  });

  it('reads an input close to the input bound', async () => {
    const rows = Array.from({ length: 30_000 }, (_, index) => ({
      id: index,
      amount: 1.5,
      note: 'x'.repeat(200),
    }));
    expect(JSON.stringify({ rows }).length).toBeGreaterThan(CHAT_SANDBOX_LIMITS.inputBytes * 0.7);

    const result = await run({ code: 'return { values: { total: sum(input.rows, "amount") } };', inputs: { rows } });

    expect(expectOk(result).values?.total).toBe(45_000);
  });

  it('reports deep recursion as a stack error', async () => {
    expectFailure({
      result: await run({ code: 'function f(n) { return f(n + 1) + 1; } return { values: { n: f(0) } };' }),
      kind: 'stack',
    });
  });

  it('reports recursion through built-ins as a stack error', async () => {
    const viaMap = await run({
      code: 'function f(n) { return [n].map((x) => f(x + 1))[0]; } return { values: { n: f(0) } };',
    });
    const viaJson = await run({
      code: 'let o = []; for (let i = 0; i < 200000; i++) o = [o]; return { values: { text: JSON.stringify(o).length } };',
    });

    expectFailure({ result: viaMap, kind: 'stack' });
    expect(viaJson.ok).toBe(false);
  });

  it('refuses a 1 MB return as an output error', async () => {
    const error = expectFailure({
      result: await run({ code: 'return { values: { big: "x".repeat(1024 * 1024) } };' }),
      kind: 'output',
    });

    expect(error.message).toMatch(/256|output/i);
  });

  it('accepts an output just under the bound', async () => {
    const result = await run({ code: 'return { values: { text: "x".repeat(200 * 1024) } };' });

    expect(expectOk(result).values?.text).toHaveLength(200 * 1024);
  });
});

describe('runSandboxedAnalysis isolation', () => {
  it('reaches no host global', async () => {
    const result = await run({
      code: `
        const names = [
          'require', 'module', 'exports', 'process', 'Buffer', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
          'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'queueMicrotask', 'structuredClone',
          'SharedArrayBuffer', 'Atomics', 'WebAssembly', 'console', 'std', 'os', 'print', 'scriptArgs', 'global',
          '__dirname', '__filename', 'performance', 'navigator', 'window', 'self', 'document', 'URL', 'TextEncoder',
          '__code', '__input', '__outputLimit',
        ];
        const present = {};
        for (const name of names) present[name] = typeof globalThis[name];
        return { values: { present, keys: Object.getOwnPropertyNames(globalThis).sort() } };
      `,
    });

    const { present } = expectOk(result).values as { present: Record<string, string> };
    const reachable = Object.entries(present).filter(([, type]) => type !== 'undefined');
    expect(reachable).toEqual([]);
  });

  it('finds no process through the Function constructor', async () => {
    const viaGlobal = await run({
      code: 'return { values: { p: globalThis.constructor.constructor("return process")() } };',
    });
    const viaArrow = await run({
      code: 'return { values: { p: (() => {}).constructor("return typeof process")() } };',
    });
    const viaThis = await run({
      code: 'return { values: { p: typeof globalThis.constructor.constructor("return globalThis")().process } };',
    });

    expectFailure({ result: viaGlobal, kind: 'runtime' });
    expect(expectOk(viaArrow).values?.p).toBe('undefined');
    expect(expectOk(viaThis).values?.p).toBe('undefined');
  });

  it('loads no module through import()', async () => {
    const result = await run({
      code: `
        let loaded = 'never';
        try {
          import('node:fs').then((m) => { loaded = typeof m.readFileSync; }, () => { loaded = 'rejected'; });
        } catch (e) {
          loaded = 'threw';
        }
        return { values: { loaded } };
      `,
    });

    expect(['never', 'threw']).toContain(expectOk(result).values?.loaded);
  });

  it('has no timer to wait on', async () => {
    expectFailure({ result: await run({ code: 'setTimeout(() => {}, 10); return { values: {} };' }), kind: 'runtime' });
    expectFailure({
      result: await run({
        code: 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000); return { values: {} };',
      }),
      kind: 'runtime',
    });
  });

  it('keeps the helpers read-only', async () => {
    const result = await run({
      code: `
        const attempts = [];
        for (const fn of [() => { sum = 1; }, () => { minor.sum = 1; }, () => { globalThis.groupBy = null; }]) {
          try { fn(); attempts.push('changed'); } catch (e) { attempts.push('refused'); }
        }
        return { values: { attempts, stillWorks: sum([1, 2]) } };
      `,
    });

    expect(expectOk(result).values).toEqual({ attempts: ['refused', 'refused', 'refused'], stillWorks: 3 });
  });

  it('does not let code change the input outside the guest', async () => {
    const inputs = { rows: [{ amount: 1 }], note: 'keep' };
    const frozenResult = await run({ code: 'input.rows[0].amount = 999; return { values: {} };', inputs });
    const copyResult = await run({
      code: 'const copy = JSON.parse(JSON.stringify(input)); copy.rows[0].amount = 999; return { values: { inCopy: copy.rows[0].amount, original: input.rows[0].amount } };',
      inputs,
    });

    expectFailure({ result: frozenResult, kind: 'runtime' });
    expect(expectOk(copyResult).values).toEqual({ inCopy: 999, original: 1 });
    expect(inputs).toEqual({ rows: [{ amount: 1 }], note: 'keep' });
  });

  it('deep-freezes the input', async () => {
    const result = await run({
      code: `
        const frozen = [input, input.rows, input.rows[0], input.deep.list];
        return { values: { frozen: frozen.map((value) => Object.isFrozen(value)) } };
      `,
      inputs: { rows: [{ amount: 1 }], deep: { list: [1, 2] } },
    });

    expect(expectOk(result).values?.frozen).toEqual([true, true, true, true]);
  });

  it('does not carry state from one run to the next', async () => {
    await run({
      code: 'globalThis.leak = 5; Object.prototype.polluted = 1; Array.prototype.extra = 2; Math.floor = () => 0; return { values: {} };',
    });

    const result = await run({
      code: 'return { values: { leak: typeof leak, polluted: typeof ({}).polluted, extra: typeof [].extra, floor: Math.floor(1.5) } };',
    });

    expect(expectOk(result).values).toEqual({ leak: 'undefined', polluted: 'undefined', extra: 'undefined', floor: 1 });
  });

  it('hands a later run zeroed memory, not what an earlier run held', async () => {
    const pool = createSandboxPool({ size: 1 });
    try {
      const secret = 'TOP-SECRET-LEDGER-ROW-'.repeat(100_000);
      await runSandboxedAnalysis({
        pool,
        code: 'const copies = []; for (let i = 0; i < 5; i++) copies.push(input.secret + i); return { values: { n: copies.length } };',
        inputs: { secret },
      });

      const result = await runSandboxedAnalysis({
        pool,
        code: `
          const bytes = new Uint8Array(4 * 1024 * 1024);
          let dirty = 0;
          for (let i = 0; i < bytes.length; i += 4096) if (bytes[i] !== 0) dirty++;
          return { values: { dirty, nonzero: bytes.indexOf(84) } };
        `,
        inputs: {},
      });

      expect(expectOk(result).values).toEqual({ dirty: 0, nonzero: -1 });
    } finally {
      await pool.terminateWorkers();
    }
  });

  it('does not leak the input of one run into another', async () => {
    await run({ code: 'return { values: {} };', inputs: { secret: 'first-run-secret' } });

    const result = await run({
      code: 'return { values: { keys: Object.keys(input), text: JSON.stringify(input) } };',
      inputs: { other: 1 },
    });

    expect(expectOk(result).values).toEqual({ keys: ['other'], text: '{"other":1}' });
  });

  it('keeps two parallel calls apart', async () => {
    const code = `
      globalThis.mine = input.name;
      let total = 0;
      for (let i = 0; i < 200000; i++) total += i % 7;
      return { values: { name: globalThis.mine, total, seen: Object.keys(input) } };
    `;

    const [first, second, third] = await Promise.all([
      run({ code, inputs: { name: 'first' } }),
      run({ code, inputs: { name: 'second', extra: true } }),
      run({ code, inputs: { name: 'third' } }),
    ]);

    expect(expectOk(first).values).toMatchObject({ name: 'first', seen: ['name'] });
    expect(expectOk(second).values).toMatchObject({ name: 'second', seen: ['name', 'extra'] });
    expect(expectOk(third).values).toMatchObject({ name: 'third', seen: ['name'] });
  });
});

describe('runSandboxedAnalysis output contract', () => {
  it.each([
    ['a number', 'return 5;'],
    ['an array', 'return [];'],
    ['null', 'return null;'],
    ['a string', 'return "ok";'],
    ['an unknown key', 'return { values: {}, extra: 1 };'],
    [
      'a chart under tables',
      'return { tables: { t: { type: "kpis", items: [{ label: "A", value: 1, kind: "number" }] } } };',
    ],
    ['a bad key', 'return { values: { "bad key": 1 } };'],
    [
      'a chart whose series is too short',
      'return { charts: { c: { type: "chart", kind: "line", title: "T", unit: { kind: "number" }, xAxis: { type: "category", values: ["a", "b"] }, series: [{ name: "S", values: [1] }] } } };',
    ],
    [
      'a table cell of the wrong kind',
      'return { tables: { t: { type: "table", title: "T", columns: [{ key: "a", label: "A", kind: "number" }], rows: [{ a: "text" }] } } };',
    ],
    [
      'a money KPI without a currency',
      'return { kpis: { k: { type: "kpis", items: [{ label: "A", value: 1, kind: "money" }] } } };',
    ],
  ])('refuses %s', async (_label, code) => {
    const error = expectFailure({ result: await run({ code }), kind: 'invalidOutput' });

    expect(error.message.length).toBeGreaterThan(0);
    expect(error.message.length).toBeLessThanOrEqual(800);
  });

  it('drops a __proto__ key instead of letting it reach a prototype', async () => {
    const result = await run({ code: 'return JSON.parse(\'{"charts":{"__proto__":{"polluted":1}}}\');' });

    const charts = expectOk(result).charts ?? {};
    expect(Object.keys(charts)).toEqual([]);
    expect(Object.getPrototypeOf(charts)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('accepts an empty object and values of any JSON shape', async () => {
    const empty = await run({ code: 'return {};' });
    const values = await run({ code: 'return { values: { a: 1, b: "x", c: [1, { d: null }], e: { f: true } } };' });

    expect(expectOk(empty)).toEqual({});
    expect(expectOk(values).values).toEqual({ a: 1, b: 'x', c: [1, { d: null }], e: { f: true } });
  });
});

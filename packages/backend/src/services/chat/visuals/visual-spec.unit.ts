import {
  CHAT_ENTITY_KINDS,
  CHAT_VISUAL_LIMITS,
  type ChatEntityCell,
  type ChatEntityRef,
  type ChatKpisSpec,
  type ChatSeriesChartSpec,
  type ChatTableCell,
  type ChatTableSpec,
  type ChatVisualSpec,
  type Expect,
  type MutuallyAssignable,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import type { z } from 'zod';

import { chatVisualSpecSchema } from './visual-spec';

// What the model may send: the shared spec minus the entity label, which only the server sets.
type ModelTableSpec = Omit<ChatTableSpec, 'rows'> & {
  rows: Array<Record<string, Exclude<ChatTableCell, ChatEntityCell> | ChatEntityRef>>;
};
type ModelVisualSpec = Exclude<ChatVisualSpec, ChatTableSpec> | ModelTableSpec;

// Compile-time: the schemas accept exactly the shared types, so the model-facing tools and the frontend renderer cannot drift apart.
export type VisualSpecIsPinned = Expect<MutuallyAssignable<z.infer<typeof chatVisualSpecSchema>, ModelVisualSpec>>;

const ENTITY_ID = '0198f1a2-7b3c-7d4e-8f50-123456789abc';

const lineChart = (): ChatSeriesChartSpec => ({
  type: 'chart',
  kind: 'line',
  title: 'Spending per month',
  unit: { kind: 'money', currencyCode: 'USD' },
  xAxis: { type: 'date', values: ['2026-01-01', '2026-02-01', '2026-03-01'] },
  series: [{ name: 'Groceries', values: [120.5, null, 98] }],
});

const table = (): ChatTableSpec => ({
  type: 'table',
  title: 'Largest payees',
  columns: [
    { key: 'payee', label: 'Payee', kind: 'entity' },
    { key: 'total', label: 'Total', kind: 'money', currencyCode: 'EUR' },
    { key: 'share', label: 'Share', kind: 'percent' },
    { key: 'last', label: 'Last seen', kind: 'date' },
    { key: 'note', label: 'Note', kind: 'text' },
  ],
  rows: [
    { payee: { kind: 'payee', id: ENTITY_ID }, total: 1200.5, share: 12.5, last: '2026-03-01', note: 'monthly' },
    { payee: null, total: 10, share: 0.1, last: null, note: null },
  ],
});

const kpis = (): ChatKpisSpec => ({
  type: 'kpis',
  items: [
    {
      label: 'Income',
      value: 5200,
      kind: 'money',
      currencyCode: 'USD',
      delta: { value: 4.2, kind: 'percent', direction: 'up' },
    },
    { label: 'Savings rate', value: 18.5, kind: 'percent' },
    { label: 'Transactions', value: 143, kind: 'number', delta: { value: 0, kind: 'percent', direction: 'flat' } },
  ],
});

const parse = (spec: unknown) => chatVisualSpecSchema.safeParse(spec);

describe('chatVisualSpecSchema: valid specs', () => {
  it.each<[string, () => unknown]>([
    ['a line chart', lineChart],
    ['an area chart', () => ({ ...lineChart(), kind: 'area' })],
    [
      'a bar chart on a category axis',
      () => ({ ...lineChart(), kind: 'bar', xAxis: { type: 'category', values: ['a', 'b', 'c'] } }),
    ],
    ['a stacked bar chart', () => ({ ...lineChart(), kind: 'stackedBar' })],
    [
      'a donut chart',
      () => ({
        type: 'chart',
        kind: 'donut',
        title: 'Share by category',
        unit: { kind: 'percent' },
        slices: [
          { label: 'Food', value: 40 },
          { label: 'Rent', value: 60 },
        ],
      }),
    ],
    ['a table', table],
    ['a KPI row', kpis],
  ])('accepts %s', (_name, build) => {
    const result = parse(build());

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toStrictEqual(build());
  });

  it('accepts a date-time on a date axis', () => {
    const spec = {
      ...lineChart(),
      xAxis: { type: 'date', values: ['2026-01-01T10:00:00Z', '2026-01-02T10:00:00+02:00', '2026-01-03'] },
    };

    expect(parse(spec).success).toBe(true);
  });

  it('upper-cases a currency code', () => {
    const result = parse({ ...lineChart(), unit: { kind: 'money', currencyCode: 'usd' } });

    expect(result.success).toBe(true);
    if (result.success)
      expect((result.data as ChatSeriesChartSpec).unit).toStrictEqual({ kind: 'money', currencyCode: 'USD' });
  });
});

describe('chatVisualSpecSchema: refusals', () => {
  it.each<[string, unknown]>([
    ['an unknown top-level key', { ...lineChart(), extra: 1 }],
    ['an unknown key on a series', { ...lineChart(), series: [{ name: 'a', values: [1, null, 2], color: 'red' }] }],
    [
      'an unknown key on the x axis',
      { ...lineChart(), xAxis: { type: 'category', values: ['a', 'b', 'c'], format: 'x' } },
    ],
    [
      'an unknown key on a column',
      { ...table(), columns: [{ key: 'a', label: 'A', kind: 'text', width: 3 }], rows: [] },
    ],
    ['an unknown key on a KPI item', { ...kpis(), items: [{ label: 'a', value: 1, kind: 'number', icon: 'x' }] }],
    ['an unknown visual type', { type: 'script', code: 'alert(1)' }],
    [
      'a donut with a series',
      { type: 'chart', kind: 'donut', title: 't', unit: { kind: 'number' }, slices: [], series: [] },
    ],
    ['a line chart without a series', { ...lineChart(), series: undefined }],
  ])('refuses %s', (_name, spec) => {
    expect(parse(spec).success).toBe(false);
  });

  it('refuses more series than the limit', () => {
    const series = Array.from({ length: CHAT_VISUAL_LIMITS.maxSeries + 1 }, (_, index) => ({
      name: `s${index}`,
      values: [1, 2, 3],
    }));

    expect(parse({ ...lineChart(), series }).success).toBe(false);
  });

  it('accepts exactly the series limit', () => {
    const series = Array.from({ length: CHAT_VISUAL_LIMITS.maxSeries }, (_, index) => ({
      name: `s${index}`,
      values: [1, 2, 3],
    }));

    expect(parse({ ...lineChart(), series }).success).toBe(true);
  });

  it('refuses more points than the limit', () => {
    const values = Array.from({ length: CHAT_VISUAL_LIMITS.maxPoints + 1 }, (_, index) => `c${index}`);
    const spec = {
      ...lineChart(),
      xAxis: { type: 'category', values },
      series: [{ name: 'a', values: values.map(() => 1) }],
    };

    expect(parse(spec).success).toBe(false);
  });

  it('refuses a series whose length differs from the x axis', () => {
    expect(parse({ ...lineChart(), series: [{ name: 'a', values: [1, 2] }] }).success).toBe(false);
  });

  it('refuses more slices than the limit', () => {
    const slices = Array.from({ length: CHAT_VISUAL_LIMITS.maxSlices + 1 }, (_, index) => ({
      label: `s${index}`,
      value: 1,
    }));

    expect(parse({ type: 'chart', kind: 'donut', title: 't', unit: { kind: 'number' }, slices }).success).toBe(false);
  });

  it('refuses more rows than the limit', () => {
    const rows = Array.from({ length: CHAT_VISUAL_LIMITS.maxRows + 1 }, () => ({ a: 'x' }));

    expect(parse({ type: 'table', title: 't', columns: [{ key: 'a', label: 'A', kind: 'text' }], rows }).success).toBe(
      false,
    );
  });

  it('refuses more columns than the limit', () => {
    const columns = Array.from({ length: CHAT_VISUAL_LIMITS.maxColumns + 1 }, (_, index) => ({
      key: `k${index}`,
      label: `K${index}`,
      kind: 'text',
    }));

    expect(parse({ type: 'table', title: 't', columns, rows: [] }).success).toBe(false);
  });

  it('refuses more KPI items than the limit', () => {
    const items = Array.from({ length: CHAT_VISUAL_LIMITS.maxKpis + 1 }, (_, index) => ({
      label: `k${index}`,
      value: index,
      kind: 'number',
    }));

    expect(parse({ type: 'kpis', items }).success).toBe(false);
  });

  it.each<[string, unknown]>([
    ['a title', { ...lineChart(), title: 'x'.repeat(CHAT_VISUAL_LIMITS.titleMaxChars + 1) }],
    [
      'a series name',
      { ...lineChart(), series: [{ name: 'x'.repeat(CHAT_VISUAL_LIMITS.seriesNameMaxChars + 1), values: [1, 2, 3] }] },
    ],
    [
      'a donut slice label',
      {
        type: 'chart',
        kind: 'donut',
        title: 't',
        unit: { kind: 'number' },
        slices: [{ label: 'x'.repeat(CHAT_VISUAL_LIMITS.seriesNameMaxChars + 1), value: 1 }],
      },
    ],
    [
      'a category label',
      {
        ...lineChart(),
        xAxis: { type: 'category', values: ['a', 'b', 'x'.repeat(CHAT_VISUAL_LIMITS.seriesNameMaxChars + 1)] },
      },
    ],
    [
      'a column label',
      {
        ...table(),
        columns: [{ key: 'a', label: 'x'.repeat(CHAT_VISUAL_LIMITS.columnLabelMaxChars + 1), kind: 'text' }],
        rows: [],
      },
    ],
    [
      'a KPI label',
      { ...kpis(), items: [{ label: 'x'.repeat(CHAT_VISUAL_LIMITS.kpiLabelMaxChars + 1), value: 1, kind: 'number' }] },
    ],
    [
      'a text cell',
      {
        type: 'table',
        title: 't',
        columns: [{ key: 'a', label: 'A', kind: 'text' }],
        rows: [{ a: 'x'.repeat(CHAT_VISUAL_LIMITS.textCellMaxChars + 1) }],
      },
    ],
  ])('refuses an over-long %s', (_name, spec) => {
    expect(parse(spec).success).toBe(false);
  });

  it.each<[string, number]>([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('refuses %s in a series', (_name, value) => {
    expect(parse({ ...lineChart(), series: [{ name: 'a', values: [1, value, 3] }] }).success).toBe(false);
  });

  it('refuses a non-finite donut value, table cell and KPI value', () => {
    const donut = {
      type: 'chart',
      kind: 'donut',
      title: 't',
      unit: { kind: 'number' },
      slices: [{ label: 'a', value: Number.NaN }],
    };
    const cell = {
      type: 'table',
      title: 't',
      columns: [{ key: 'a', label: 'A', kind: 'number' }],
      rows: [{ a: Number.POSITIVE_INFINITY }],
    };
    const kpi = { type: 'kpis', items: [{ label: 'a', value: Number.NaN, kind: 'number' }] };

    expect([parse(donut).success, parse(cell).success, parse(kpi).success]).toStrictEqual([false, false, false]);
  });

  it.each<[string]>([['01/02/2026'], ['2026-13-40'], ['yesterday'], ['2026-2-1'], ['']])(
    'refuses %j on a date axis',
    (value) => {
      const spec = { ...lineChart(), xAxis: { type: 'date', values: ['2026-01-01', '2026-02-01', value] } };

      expect(parse(spec).success).toBe(false);
    },
  );

  it('refuses a non-ISO date in a date column', () => {
    const spec = {
      type: 'table',
      title: 't',
      columns: [{ key: 'd', label: 'D', kind: 'date' }],
      rows: [{ d: 'March 3rd' }],
    };

    expect(parse(spec).success).toBe(false);
  });

  it('refuses money without a currency code', () => {
    const chart = { ...lineChart(), unit: { kind: 'money' } };
    const column = { type: 'table', title: 't', columns: [{ key: 'a', label: 'A', kind: 'money' }], rows: [] };
    const kpi = { type: 'kpis', items: [{ label: 'a', value: 1, kind: 'money' }] };
    const delta = {
      type: 'kpis',
      items: [{ label: 'a', value: 1, kind: 'number', delta: { value: 2, kind: 'money', direction: 'up' } }],
    };

    expect([chart, column, kpi, delta].map((spec) => parse(spec).success)).toStrictEqual([false, false, false, false]);
  });

  it('refuses a malformed currency code', () => {
    expect(parse({ ...lineChart(), unit: { kind: 'money', currencyCode: 'US$ ' } }).success).toBe(false);
  });

  it('refuses a cell whose type does not match its column', () => {
    const spec = {
      type: 'table',
      title: 't',
      columns: [
        { key: 'a', label: 'A', kind: 'number' },
        { key: 'b', label: 'B', kind: 'text' },
      ],
      rows: [{ a: 'seven', b: 1 }],
    };

    expect(parse(spec).success).toBe(false);
  });

  it('refuses a cell for a column that does not exist', () => {
    const spec = {
      type: 'table',
      title: 't',
      columns: [{ key: 'a', label: 'A', kind: 'text' }],
      rows: [{ a: 'x', hidden: 'y' }],
    };

    expect(parse(spec).success).toBe(false);
  });

  it('refuses duplicate column keys', () => {
    const spec = {
      type: 'table',
      title: 't',
      columns: [
        { key: 'a', label: 'A', kind: 'text' },
        { key: 'a', label: 'B', kind: 'text' },
      ],
      rows: [],
    };

    expect(parse(spec).success).toBe(false);
  });

  it('refuses an entity cell of an unknown kind or with a blank id', () => {
    const column = [{ key: 'e', label: 'E', kind: 'entity' }];

    expect(
      parse({ type: 'table', title: 't', columns: column, rows: [{ e: { kind: 'secrets', id: ENTITY_ID } }] }).success,
    ).toBe(false);
    expect(
      parse({ type: 'table', title: 't', columns: column, rows: [{ e: { kind: 'payee', id: '' } }] }).success,
    ).toBe(false);
  });

  it('refuses a visual above the size limit', () => {
    const values = Array.from({ length: CHAT_VISUAL_LIMITS.maxPoints }, (_, index) =>
      `${'x'.repeat(CHAT_VISUAL_LIMITS.seriesNameMaxChars)}${index}`.slice(0, CHAT_VISUAL_LIMITS.seriesNameMaxChars),
    );
    const series = Array.from({ length: CHAT_VISUAL_LIMITS.maxSeries }, (_, index) => ({
      name: `s${index}`,
      values: values.map(() => 123456789.12345678),
    }));
    const spec = { ...lineChart(), xAxis: { type: 'category', values }, series };

    expect(Buffer.byteLength(JSON.stringify(spec))).toBeGreaterThan(CHAT_VISUAL_LIMITS.maxBytes);
    expect(parse(spec).success).toBe(false);
  });
});

describe('chatVisualSpecSchema: entity cells', () => {
  it('keeps only kind and id of an entity cell', () => {
    const spec = {
      type: 'table',
      title: 't',
      columns: [{ key: 'e', label: 'E', kind: 'entity' }],
      rows: [{ e: { kind: 'payee', id: ENTITY_ID, label: 'Injected <b>label</b>', href: 'https://evil.example' } }],
    };

    const result = parse(spec);

    expect(result.success).toBe(true);
    if (result.success)
      expect((result.data as ChatTableSpec).rows).toStrictEqual([{ e: { kind: 'payee', id: ENTITY_ID } }]);
  });

  it('accepts every entity kind', () => {
    for (const kind of CHAT_ENTITY_KINDS) {
      const spec = {
        type: 'table',
        title: 't',
        columns: [{ key: 'e', label: 'E', kind: 'entity' }],
        rows: [{ e: { kind, id: ENTITY_ID } }],
      };

      expect(parse(spec).success).toBe(true);
    }
  });
});

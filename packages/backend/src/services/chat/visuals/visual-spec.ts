import { CHAT_ENTITY_KINDS, CHAT_VISUAL_LIMITS } from '@bt/shared/types';
import { currencyCode } from '@common/lib/zod/custom-types';
import { z } from 'zod';

/**
 * Zod schemas of the display tools' spec (`render_chart`, `render_table`, `render_kpis`). The model
 * can put nothing else into an answer's chart, table or KPI row, so every object is `.strict()`, every
 * collection and string is bounded by `CHAT_VISUAL_LIMITS`, and numbers must be finite. The inferred
 * type is pinned to the shared `ChatVisualSpec` by a type test in `visual-spec.unit.ts`.
 *
 * The one object that is not strict is an entity cell: models habitually add a `label` or a link to
 * it, and the server resolves labels itself, so the schema keeps `{ kind, id }` and drops the rest.
 */

const LIMITS = CHAT_VISUAL_LIMITS;

const label = ({ max }: { max: number }) => z.string().trim().min(1).max(max);

const finiteNumber = () => z.number();

const isoDateOrDateTime = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

const isIsoDateOrDateTime = (value: string) => isoDateOrDateTime.safeParse(value).success;

const unitSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('money'), currencyCode: currencyCode() }).strict(),
  z.object({ kind: z.literal('number') }).strict(),
  z.object({ kind: z.literal('percent') }).strict(),
]);

const axisSchema = z
  .object({
    type: z.enum(['date', 'category']),
    values: z.array(z.string().max(LIMITS.seriesNameMaxChars)).min(1).max(LIMITS.maxPoints),
  })
  .strict()
  .superRefine((axis, ctx) => {
    axis.values.forEach((value, index) => {
      const valid = axis.type === 'date' ? isIsoDateOrDateTime(value) : value.trim().length > 0;

      if (!valid) {
        ctx.addIssue({
          code: 'custom',
          path: ['values', index],
          message:
            axis.type === 'date'
              ? 'A date axis takes ISO 8601 dates or date-times'
              : 'A category label cannot be empty',
        });
      }
    });
  });

const seriesChartSchema = z
  .object({
    type: z.literal('chart'),
    kind: z.enum(['line', 'area', 'bar', 'stackedBar']),
    title: label({ max: LIMITS.titleMaxChars }),
    unit: unitSchema,
    xAxis: axisSchema,
    series: z
      .array(
        z
          .object({
            name: label({ max: LIMITS.seriesNameMaxChars }),
            values: z.array(finiteNumber().nullable()).max(LIMITS.maxPoints),
          })
          .strict(),
      )
      .min(1)
      .max(LIMITS.maxSeries),
  })
  .strict()
  .superRefine((chart, ctx) => {
    chart.series.forEach((series, index) => {
      if (series.values.length !== chart.xAxis.values.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['series', index, 'values'],
          message: 'A series needs one value per x axis value',
        });
      }
    });
  });

const donutChartSchema = z
  .object({
    type: z.literal('chart'),
    kind: z.literal('donut'),
    title: label({ max: LIMITS.titleMaxChars }),
    unit: unitSchema,
    slices: z
      .array(z.object({ label: label({ max: LIMITS.seriesNameMaxChars }), value: finiteNumber().min(0) }).strict())
      .min(1)
      .max(LIMITS.maxSlices),
  })
  .strict();

export const chatChartSpecSchema = z.discriminatedUnion('kind', [seriesChartSchema, donutChartSchema]);

const entityCellSchema = z.object({
  kind: z.enum(CHAT_ENTITY_KINDS),
  id: z.string().min(1).max(64),
});

const cellSchema = z.union([z.string().max(LIMITS.textCellMaxChars), finiteNumber(), entityCellSchema, z.null()]);

/** Column keys name row properties, so they start with a letter: `__proto__` and friends cannot be one. */
const COLUMN_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

const columnSchema = z
  .object({
    key: z.string().regex(COLUMN_KEY_PATTERN),
    label: label({ max: LIMITS.columnLabelMaxChars }),
    kind: z.enum(['text', 'money', 'number', 'date', 'percent', 'entity']),
    currencyCode: currencyCode().optional(),
  })
  .strict()
  .superRefine((column, ctx) => {
    if (column.kind === 'money' && column.currencyCode === undefined) {
      ctx.addIssue({ code: 'custom', path: ['currencyCode'], message: 'A money column needs a currency code' });
    }
    if (column.kind !== 'money' && column.currencyCode !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['currencyCode'], message: 'Only a money column takes a currency code' });
    }
  });

const isCellOfKind = ({
  kind,
  cell,
}: {
  kind: z.infer<typeof columnSchema>['kind'];
  cell: z.infer<typeof cellSchema>;
}) => {
  if (cell === null) return true;
  switch (kind) {
    case 'text':
      return typeof cell === 'string';
    case 'date':
      return typeof cell === 'string' && isIsoDateOrDateTime(cell);
    case 'number':
    case 'money':
    case 'percent':
      return typeof cell === 'number';
    case 'entity':
      return typeof cell === 'object';
  }
};

export const chatTableSpecSchema = z
  .object({
    type: z.literal('table'),
    title: label({ max: LIMITS.titleMaxChars }),
    columns: z.array(columnSchema).min(1).max(LIMITS.maxColumns),
    rows: z.array(z.record(z.string(), cellSchema)).max(LIMITS.maxRows),
  })
  .strict()
  .superRefine((table, ctx) => {
    const columnsByKey = new Map(table.columns.map((column) => [column.key, column]));

    if (columnsByKey.size !== table.columns.length) {
      ctx.addIssue({ code: 'custom', path: ['columns'], message: 'Column keys must be unique' });
    }

    table.rows.forEach((row, rowIndex) => {
      for (const [key, cell] of Object.entries(row)) {
        const column = columnsByKey.get(key);

        if (!column) {
          ctx.addIssue({ code: 'custom', path: ['rows', rowIndex, key], message: 'The cell has no column' });
        } else if (!isCellOfKind({ kind: column.kind, cell })) {
          ctx.addIssue({
            code: 'custom',
            path: ['rows', rowIndex, key],
            message: `The cell does not match its ${column.kind} column`,
          });
        }
      }
    });
  });

const kpiItemSchema = z
  .object({
    label: label({ max: LIMITS.kpiLabelMaxChars }),
    value: finiteNumber(),
    kind: z.enum(['money', 'number', 'percent']),
    currencyCode: currencyCode().optional(),
    delta: z
      .object({
        value: finiteNumber(),
        kind: z.enum(['percent', 'money']),
        direction: z.enum(['up', 'down', 'flat']),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.kind === 'money' && item.currencyCode === undefined) {
      ctx.addIssue({ code: 'custom', path: ['currencyCode'], message: 'A money value needs a currency code' });
    }
    if (item.kind !== 'money' && item.currencyCode !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['currencyCode'], message: 'Only a money value takes a currency code' });
    }
    if (item.delta?.kind === 'money' && item.kind !== 'money') {
      ctx.addIssue({ code: 'custom', path: ['delta', 'kind'], message: 'A money delta needs a money value' });
    }
  });

export const chatKpisSpecSchema = z
  .object({
    type: z.literal('kpis'),
    items: z.array(kpiItemSchema).min(1).max(LIMITS.maxKpis),
  })
  .strict();

export const chatVisualSpecSchema = z
  .union([chatChartSpecSchema, chatTableSpecSchema, chatKpisSpecSchema])
  .superRefine((spec, ctx) => {
    if (Buffer.byteLength(JSON.stringify(spec)) > LIMITS.maxBytes) {
      ctx.addIssue({ code: 'custom', message: `A visual is limited to ${LIMITS.maxBytes} bytes` });
    }
  });

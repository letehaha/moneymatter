import type { ChatEntityRef } from './fields';

/**
 * The display tools' spec, the only structure the model can use to put a chart, table or KPI row in an
 * answer. It is plain data: the frontend draws it with its own chart library and the server validates
 * it with the zod schemas in `services/chat/visuals/visual-spec.ts`, which a type test pins to these
 * types. Limits live in `CHAT_VISUAL_LIMITS`.
 */

export type ChatChartKind = 'line' | 'area' | 'bar' | 'stackedBar' | 'donut';

export type ChatChartUnit = { kind: 'money'; currencyCode: string } | { kind: 'number' } | { kind: 'percent' };

export interface ChatChartAxis {
  /** `date` values are ISO 8601 dates or date-times; `category` values are labels. */
  type: 'date' | 'category';
  values: string[];
}

export interface ChatChartSeries {
  name: string;
  /** One value per x axis value; `null` leaves a gap. */
  values: Array<number | null>;
}

export interface ChatSeriesChartSpec {
  type: 'chart';
  kind: Exclude<ChatChartKind, 'donut'>;
  title: string;
  unit: ChatChartUnit;
  xAxis: ChatChartAxis;
  series: ChatChartSeries[];
}

export interface ChatDonutSlice {
  label: string;
  value: number;
}

export interface ChatDonutChartSpec {
  type: 'chart';
  kind: 'donut';
  title: string;
  unit: ChatChartUnit;
  slices: ChatDonutSlice[];
}

export type ChatChartSpec = ChatSeriesChartSpec | ChatDonutChartSpec;

export type ChatTableColumnKind = 'text' | 'money' | 'number' | 'date' | 'percent' | 'entity';

export interface ChatTableColumn {
  key: string;
  label: string;
  kind: ChatTableColumnKind;
  /** Required on a `money` column. */
  currencyCode?: string;
}

/**
 * An entity reference in a table cell. `label` is the entity's display name, set by the server from the
 * user's own data after the spec is validated; the model cannot supply it (the validator drops it), and
 * it is absent when the entity is missing or not the user's. Show it as text only.
 */
export interface ChatEntityCell extends ChatEntityRef {
  /** Server-resolved. */
  label?: string;
}

/** A cell holds a number, a string, an entity reference or nothing; the column's kind says which. */
export type ChatTableCell = string | number | ChatEntityCell | null;

export type ChatTableRow = Record<string, ChatTableCell>;

export interface ChatTableSpec {
  type: 'table';
  title: string;
  columns: ChatTableColumn[];
  rows: ChatTableRow[];
}

export type ChatKpiDelta = {
  value: number;
  kind: 'percent' | 'money';
  direction: 'up' | 'down' | 'flat';
};

export interface ChatKpiItem {
  label: string;
  value: number;
  kind: 'money' | 'number' | 'percent';
  /** Required when `kind` is `money`, and for a `money` delta. */
  currencyCode?: string;
  delta?: ChatKpiDelta;
}

export interface ChatKpisSpec {
  type: 'kpis';
  items: ChatKpiItem[];
}

export type ChatVisualSpec = ChatChartSpec | ChatTableSpec | ChatKpisSpec;

/** Bounds of the display tools (`render_chart`, `render_table`, `render_kpis`). */
export const CHAT_VISUAL_LIMITS = {
  /** Title of a chart or table. */
  titleMaxChars: 120,
  /** Points on a chart's x axis. */
  maxPoints: 400,
  /** Series on a line, area or bar chart. */
  maxSeries: 12,
  /** Series name, slice label, category label. */
  seriesNameMaxChars: 60,
  /** Slices of a donut; the frontend folds the rest into "Others". */
  maxSlices: 12,
  /** Columns of a table. */
  maxColumns: 8,
  /** Table column label. */
  columnLabelMaxChars: 60,
  /** Table rows. */
  maxRows: 200,
  /** Characters of a text cell. */
  textCellMaxChars: 500,
  /** KPI tiles. */
  maxKpis: 6,
  /** KPI label. */
  kpiLabelMaxChars: 40,
  /** Serialized size of one visual. */
  maxBytes: 64 * 1024,
  /** Visuals per message. */
  maxPerMessage: 8,
} as const;

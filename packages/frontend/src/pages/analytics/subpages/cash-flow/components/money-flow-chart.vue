<template>
  <div ref="containerRef" class="relative w-full">
    <svg ref="svgRef" class="block w-full"></svg>

    <div
      v-show="tooltip.visible"
      ref="tooltipRef"
      class="pointer-events-none absolute z-10"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      <ChartTooltip>
        <ChartTooltipHeader>
          <span class="text-card-tooltip-foreground">{{ tooltip.title }}</span>
        </ChartTooltipHeader>
        <ChartTooltipRow
          v-for="(row, i) in tooltip.rows"
          :key="i"
          :color="row.color"
          :label="row.label"
          :value="row.value"
        />
        <p v-if="tooltip.description" class="text-muted-foreground mt-1 max-w-64 text-xs">{{ tooltip.description }}</p>
      </ChartTooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { currentTheme } from '@/common/utils/color-theme';
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import { useFormatCurrency } from '@/composable';
import { getChartColors } from '@/composable/charts/chart-colors';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useDateLocale } from '@/composable/use-date-locale';
import { useCurrenciesStore } from '@/stores';
import * as d3 from 'd3';
import { useResizeObserver } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  CASH_NODE_ID,
  DEFICIT_NODE_ID,
  type MoneyFlow,
  type MoneyFlowNode,
  formatShare,
  nodeColor,
  nodeLabel,
} from '../utils/build-money-flow';
import { spreadTops } from '../utils/spread-tops';

const props = defineProps<{
  flow: MoneyFlow;
}>();

const { t } = useI18n();
const { locale } = useDateLocale();
const { formatBaseCurrency, formatCompactAmount } = useFormatCurrency();
const { baseCurrency } = storeToRefs(useCurrenciesStore());

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  title: '',
  rows: [] as TooltipRow[],
  description: '',
});

const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

const NODE_WIDTH = 12;
const HUB_WIDTH = 24;
const NODE_GAP = 12;
// Column positions as a share of the ribbon span. Hub→mid carries two fat ribbons and
// needs little room; the fan-out to categories on the right is where curves get crowded.
const COLUMNS = { hub: 0.34, mid: 0.56, group: 0 };
// The root-category column needs ribbon room on both sides, and its labels sit in the gap before it.
const GROUPED_COLUMNS = { hub: 0.3, mid: 0.48, group: 0.76 };
const ROW_HEIGHT = 48;
// Two expense levels multiply the terminal rows, so each one gets less height.
const GROUPED_ROW_HEIGHT = 30;
const MIN_HEIGHT = 400;
const LABEL_OFFSET = 12;
const LABEL_ROW_HEIGHT = 20;
const DETAIL_ROW_HEIGHT = 36;
const DETAIL_MIN_NODE_HEIGHT = 36;
const DETAIL_LINE_OFFSET = 16;
const PILL_PADDING = 6;
const PILL_OPACITY = 0.85;
const PILL_RADIUS = 5;
const PILL_EXTRA_HEIGHT = 2;
// Name baselines: below the top of a label row, and around the vertical center of a column node.
const NAME_BASELINE_OFFSET = 14;
const CENTERED_BASELINE_OFFSET = 5;
const CENTERED_STACKED_BASELINE_OFFSET = -3;
const LINK_HIGHLIGHT_OPACITY = 0.45;
const LINK_DIM_OPACITY = 0.06;
// The right label column is reserved up front so the bars stay put when the period changes.
// Source labels need no column: they sit over their own ribbons.
const INSIDE_LABEL_MIN_WIDTH = 60;
const LABEL_COLUMN_MAX = 180;
const LABEL_COLUMN_MIN = 120;
const LABEL_COLUMN_SHARE = 0.2;
// Subcategory names run longer than root ones, so their column is wider.
const GROUPED_LABEL_COLUMN_MAX = 250;
const GROUPED_LABEL_COLUMN_SHARE = 0.26;
const LABEL_FONT_SIZE = 14;
const DETAIL_FONT_SIZE = 13;
const GROUP_LABEL_GAP = 6;
const OTHER_TOOLTIP_MAX_ROWS = 20;

interface Box {
  y0: number;
  y1: number;
}

const stack = ({ values, scale, start = 0 }: { values: number[]; scale: number; start?: number }): Box[] => {
  let cursor = start;
  return values.map((value) => {
    const box = { y0: cursor, y1: cursor + value * scale };
    cursor = box.y1 + NODE_GAP;
    return box;
  });
};

const ribbon = ({ x0, x1, a, b }: { x0: number; x1: number; a: Box; b: Box }) => {
  const xm = (x0 + x1) / 2;
  return `M${x0} ${a.y0} C ${xm} ${a.y0}, ${xm} ${b.y0}, ${x1} ${b.y0} L ${x1} ${b.y1} C ${xm} ${b.y1}, ${xm} ${a.y1}, ${x0} ${a.y1} Z`;
};

const fitsTwoLines = ({ box }: { box: Box }) => box.y1 - box.y0 >= DETAIL_MIN_NODE_HEIGHT;

const measureCtx = document.createElement('canvas').getContext('2d');
const textWidth = ({ text, font }: { text: string; font: string }) => {
  if (!measureCtx) return text.length * 8;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
};

const fitText = ({ text, font, max }: { text: string; font: string; max: number }) => {
  if (textWidth({ text, font }) <= max) return text;
  let end = text.length;
  while (end > 1 && textWidth({ text: `${text.slice(0, end).trimEnd()}…`, font }) > max) end--;
  return `${text.slice(0, end).trimEnd()}…`;
};

interface TooltipContent {
  title: string;
  rows: TooltipRow[];
  description?: string;
}

const bindTooltip = <T extends d3.BaseType>({
  selection,
  content,
}: {
  selection: d3.Selection<T, unknown, null, undefined>;
  content: TooltipContent;
}) =>
  selection
    .on('mouseenter', (event: MouseEvent) => {
      tooltip.title = content.title;
      tooltip.rows = content.rows;
      tooltip.description = content.description ?? '';
      tooltip.visible = true;
      updateTooltipPosition(event);
    })
    .on('mousemove', (event: MouseEvent) => updateTooltipPosition(event))
    .on('mouseleave', () => {
      tooltip.visible = false;
    });

const renderChart = () => {
  const currencyCode = baseCurrency.value?.currency?.code;
  if (!svgRef.value || !containerRef.value || !currencyCode) return;

  const { flow } = props;
  // Everything the hub receives (income plus deficit) equals everything it sends out.
  const hub = flow.expenses + flow.taxes + flow.savings;
  const grouped = flow.expenseGroups.length > 0;
  const columns = grouped ? GROUPED_COLUMNS : COLUMNS;

  const colors = getChartColors();
  const width = containerRef.value.clientWidth;
  const fontFamily = getComputedStyle(svgRef.value).fontFamily;
  const nameFont = `600 ${LABEL_FONT_SIZE}px ${fontFamily}`;
  const detailFont = `${DETAIL_FONT_SIZE}px ${fontFamily}`;
  const labelColumn = Math.round(Math.min(LABEL_COLUMN_MAX, Math.max(LABEL_COLUMN_MIN, width * LABEL_COLUMN_SHARE)));
  const rightLabelColumn = grouped
    ? Math.round(Math.min(GROUPED_LABEL_COLUMN_MAX, Math.max(LABEL_COLUMN_MIN, width * GROUPED_LABEL_COLUMN_SHARE)))
    : labelColumn;
  const compactAmount = (value: number) => formatCompactAmount(value, currencyCode);

  // Label rows: name plus amount on one line, or stacked when the node is tall enough
  // to own two lines. The name is truncated to whatever `max` has left after the amount,
  // unless `nameOnly` lets a one-line row drop the amount to keep the name whole.
  interface LabelRow {
    node: MoneyFlowNode;
    box: Box;
    content: TooltipContent;
    /** Highlight key of the node this row labels. */
    key: string;
    name: string;
    amount: string;
    share: string;
    detailed: boolean;
  }
  const labelRow = ({
    node,
    box,
    content,
    key,
    max,
    nameOnly = false,
  }: {
    node: MoneyFlowNode;
    box: Box;
    content: TooltipContent;
    key: string;
    max: number;
    nameOnly?: boolean;
  }): LabelRow => {
    const detailed = fitsTwoLines({ box });
    const amount = compactAmount(node.value);
    const share = `(${formatShare(node.share)})`;
    const detailWidth = textWidth({ text: `${amount} ${share}`, font: detailFont });
    const text = nodeLabel({ node, t });
    const row = { node, box, content, key, detailed };
    if (nameOnly && !detailed && textWidth({ text, font: nameFont }) + detailWidth + 5 > max) {
      return { ...row, name: fitText({ text, font: nameFont, max }), amount: '', share: '' };
    }
    const name = fitText({ text, font: nameFont, max: detailed ? max : max - detailWidth - 5 });
    return { ...row, name, amount, share };
  };
  const amountRow = ({ value, color }: { value: number; color: string }): TooltipRow => ({
    label: t('analytics.cashFlow.composition.amount'),
    value: formatBaseCurrency(value),
    color,
  });
  const categoryTooltip = ({
    node,
    color,
    shareLabel,
  }: {
    node: MoneyFlowNode;
    color: string;
    shareLabel: string;
  }) => ({
    title: node.parentName ? `${node.parentName} › ${nodeLabel({ node, t })}` : nodeLabel({ node, t }),
    rows: [
      amountRow({ value: node.value, color }),
      { label: shareLabel, value: formatShare(node.share) },
      ...otherBreakdownRows({ node, color }),
    ],
  });
  const otherBreakdownRows = ({ node, color }: { node: MoneyFlowNode; color: string }): TooltipRow[] => {
    const children = node.children ?? [];
    const rows = children.slice(0, OTHER_TOOLTIP_MAX_ROWS).map((c) => ({
      label: c.name,
      value: formatBaseCurrency(c.value),
      color: c.color ?? color,
    }));
    const hidden = children.length - rows.length;
    return hidden > 0
      ? [...rows, { label: t('analytics.cashFlow.composition.andMore', { count: hidden }), value: '' }]
      : rows;
  };
  const shareOfIncome = t('analytics.cashFlow.composition.shareOfIncome');
  const shareOfExpenses = t('analytics.cashFlow.composition.shareOfExpenses');

  interface Outflow {
    id: 'taxes' | 'expenses' | 'savings';
    name: string;
    value: number;
    color: string;
    items: MoneyFlowNode[];
    shareLabel: string;
  }
  // One mid node per outflow kind; its terminal nodes share the right column in the same order.
  const allOutflows: Outflow[] = [
    {
      id: 'taxes',
      name: t('analytics.cashFlow.composition.taxes'),
      value: flow.taxes,
      color: colors.primary,
      // Taxes end at their mid node: nothing is bought with them, so no ribbon runs on to the right.
      items: [],
      shareLabel: '',
    },
    {
      id: 'expenses',
      name: t('analytics.cashFlow.expenses'),
      value: flow.expenses,
      color: colors.appExpense,
      items: flow.expenseNodes,
      shareLabel: shareOfExpenses,
    },
    {
      id: 'savings',
      name: t('analytics.cashFlow.composition.savings'),
      value: flow.savings,
      color: colors.appSavings,
      items: flow.savingsNodes,
      shareLabel: t('analytics.cashFlow.composition.shareOfSavings'),
    },
  ];
  const outflows = allOutflows.filter((n) => n.value > 0);
  const isTerminal = ({ outflow }: { outflow: Outflow }) => outflow.items.length === 0;
  const rightNodes = outflows.flatMap((o) => o.items);

  const overspend = Math.max(0, -flow.net);
  const invested = flow.savingsNodes.filter((n) => n.id !== CASH_NODE_ID).reduce((sum, n) => sum + n.value, 0);
  const deficitDescription = () => {
    const money = (v: number) => formatBaseCurrency(v);
    if (overspend && invested) {
      return t('analytics.cashFlow.composition.deficitBoth', {
        overspend: money(overspend),
        invested: money(invested),
      });
    }
    if (overspend) return t('analytics.cashFlow.composition.deficitOverspend', { amount: money(overspend) });
    return t('analytics.cashFlow.composition.deficitInvested', { invested: money(invested), saved: money(flow.net) });
  };
  const leftTooltip = (node: MoneyFlowNode): TooltipContent =>
    node.id === DEFICIT_NODE_ID
      ? {
          title: nodeLabel({ node, t }),
          rows: [amountRow({ value: node.value, color: colors.warningText })],
          description: deficitDescription(),
        }
      : categoryTooltip({ node, color: colors.appIncome, shareLabel: shareOfIncome });
  const midTooltip = (node: Outflow) => ({
    title: node.name,
    rows: [
      amountRow({ value: node.value, color: node.color }),
      ...(flow.income > 0 ? [{ label: shareOfIncome, value: formatShare(node.value / flow.income) }] : []),
      ...(node.id === 'taxes' && flow.taxNodes.length > 1
        ? flow.taxNodes.map((n) => ({ label: n.name, value: formatBaseCurrency(n.value), color: n.color }))
        : []),
    ],
  });
  const hubLabel = t(
    flow.sources.some((n) => n.id === DEFICIT_NODE_ID)
      ? 'analytics.cashFlow.composition.incomePlusDeficit'
      : 'analytics.cashFlow.composition.totalIncome',
  );
  const hubTooltip = {
    title: hubLabel,
    rows: [amountRow({ value: hub, color: colors.appIncome })],
  };

  // The right column starts level with the first mid node that feeds it, below any terminal ones.
  const terminalMidNodes = Math.max(
    0,
    outflows.findIndex((outflow) => !isTerminal({ outflow })),
  );
  const rows = Math.max(flow.sources.length, outflows.length, rightNodes.length + terminalMidNodes);
  const height = Math.max(MIN_HEIGHT, rows * (grouped ? GROUPED_ROW_HEIGHT : ROW_HEIGHT));
  const scale = (height - (rows - 1) * NODE_GAP) / hub;

  const leftBoxes = stack({ values: flow.sources.map((n) => n.value), scale });
  const hubBox: Box = { y0: 0, y1: hub * scale };
  const midBoxes = stack({ values: outflows.map((n) => n.value), scale });
  const rightBoxes = stack({
    values: rightNodes.map((n) => n.value),
    scale,
    start: midBoxes[terminalMidNodes]?.y0,
  });

  const xRight = width - rightLabelColumn - NODE_WIDTH;
  const span = xRight - NODE_WIDTH;
  const xHub = NODE_WIDTH + span * columns.hub - HUB_WIDTH / 2;
  const xMid = NODE_WIDTH + span * columns.mid - HUB_WIDTH / 2;
  const xGroup = NODE_WIDTH + span * columns.group - NODE_WIDTH / 2;

  // An inside label runs from its node up to the hub's centered label.
  const hubLabelWidth = Math.max(
    textWidth({ text: hubLabel, font: nameFont }),
    textWidth({ text: compactAmount(hub), font: detailFont }),
  );
  const xInside = NODE_WIDTH + LABEL_OFFSET;
  const insideMax = Math.max(INSIDE_LABEL_MIN_WIDTH, xHub + HUB_WIDTH / 2 - hubLabelWidth / 2 - LABEL_OFFSET - xInside);
  const leftRows = flow.sources.map((node, i) =>
    labelRow({
      node,
      box: leftBoxes[i]!,
      content: leftTooltip(node),
      key: `source:${node.id}`,
      max: insideMax,
      nameOnly: true,
    }),
  );
  // Leaf ids repeat across parents (each root has its own "other"), so the parent scopes the key.
  const leafKey = ({ parentKey, node }: { parentKey: string; node: MoneyFlowNode }) => `${parentKey}>${node.id}`;
  // Right-column leaves in `rightBoxes` order; a grouped leaf hangs off its root category and inherits its color.
  const rightLeaves = outflows
    .flatMap((outflow) =>
      grouped && outflow.id === 'expenses'
        ? flow.expenseGroups.flatMap((group) => {
            const fallback = nodeColor({ node: group, colors, fallback: colors.appExpense });
            return group.leaves.map((node) => ({ node, parentKey: `group:${group.id}`, fallback, outflow }));
          })
        : outflow.items.map((node) => ({ node, parentKey: `mid:${outflow.id}`, fallback: outflow.color, outflow })),
    )
    .map(({ node, parentKey, fallback, outflow }, i) => {
      const color = nodeColor({ node, colors, fallback });
      return {
        node,
        box: rightBoxes[i]!,
        key: leafKey({ parentKey, node }),
        parentKey,
        color,
        content: categoryTooltip({ node, color, shareLabel: outflow.shareLabel }),
      };
    });
  const leavesOf = ({ parentKey }: { parentKey: string }) => rightLeaves.filter((leaf) => leaf.parentKey === parentKey);
  const rightRows = rightLeaves.map(({ node, box, content, key }) =>
    labelRow({ node, box, content, key, max: rightLabelColumn - LABEL_OFFSET }),
  );
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${width} ${height}`).attr('height', height);

  const links = svg.append('g');
  const nodes = svg.append('g');
  const labels = svg.append('g').attr('font-size', LABEL_FONT_SIZE);

  const emphasize = ({ isActive }: { isActive?: (path: SVGPathElement) => boolean } = {}) =>
    links.selectAll<SVGPathElement, unknown>('path').attr('fill-opacity', function () {
      if (!isActive) return this.dataset.opacity!;
      return isActive(this) ? LINK_HIGHLIGHT_OPACITY : LINK_DIM_OPACITY;
    });
  const highlight = ({ key }: { key: string }) =>
    emphasize({ isActive: (path) => path.dataset.ends!.split(' ').includes(key) });
  // Every ribbon records the keys of the two nodes it joins, so hovering a node can pick its ribbons.
  // Hovering the ribbon itself singles it out.
  const drawLink = ({
    d,
    color,
    opacity,
    ends,
    names,
    value,
  }: {
    d: string;
    color: string;
    opacity: number;
    ends: [string, string];
    names: [string, string];
    value: number;
  }) =>
    bindTooltip({
      selection: links
        .append('path')
        .attr('d', d)
        .attr('fill', color)
        .attr('fill-opacity', opacity)
        .attr('data-opacity', opacity)
        .attr('data-ends', ends.join(' ')),
      content: { title: names.join(' → '), rows: [amountRow({ value, color })] },
    })
      .on('mouseenter.highlight', (event: MouseEvent) =>
        emphasize({ isActive: (path) => path === event.currentTarget }),
      )
      .on('mouseleave.highlight', () => emphasize());
  // Namespaced so it stacks with the tooltip handlers on the same element.
  const bindHighlight = <T extends d3.BaseType>({
    selection,
    key,
  }: {
    selection: d3.Selection<T, unknown, null, undefined>;
    key: string;
  }) => selection.on('mouseenter.highlight', () => highlight({ key })).on('mouseleave.highlight', () => emphasize());

  const drawNode = ({
    x,
    box,
    w,
    color,
    content,
    key,
  }: {
    x: number;
    box: Box;
    w: number;
    color: string;
    content?: TooltipContent;
    key?: string;
  }) => {
    const rect = nodes
      .append('rect')
      .attr('x', x)
      .attr('y', box.y0)
      .attr('width', w)
      .attr('height', Math.max(box.y1 - box.y0, 1))
      .attr('rx', 2)
      .attr('fill', color);
    if (content) bindTooltip({ selection: rect, content });
    if (key) bindHighlight({ selection: rect, key });
    return rect;
  };

  // Labels drawn over ribbons carry a card-colored outline to stay readable.
  // `y` is the name's baseline; a stacked amount takes the line below it, an inline one follows the name.
  const haloLabel = ({
    x,
    y,
    anchor,
    text,
    amount = '',
    stacked = false,
  }: {
    x: number;
    y: number;
    anchor: 'middle' | 'end';
    text: string;
    amount?: string;
    stacked?: boolean;
  }) => {
    const group = labels
      .append('g')
      .attr('text-anchor', anchor)
      .attr('fill', colors.foreground)
      .attr('paint-order', 'stroke')
      .attr('stroke', colors.card)
      .attr('stroke-width', 3)
      .attr('pointer-events', 'none');
    const name = group.append('text').attr('x', x).attr('y', y).attr('font-weight', 600).text(text);
    if (!amount) return;
    const detail = stacked
      ? group
          .append('text')
          .attr('x', x)
          .attr('y', y + DETAIL_LINE_OFFSET)
      : name.append('tspan');
    detail
      .attr('font-size', DETAIL_FONT_SIZE)
      .attr('font-weight', 400)
      .text(stacked ? amount : ` ${amount}`);
  };
  // A node too short for two lines keeps its name only.
  const columnLabel = ({ x, box, text, value }: { x: number; box: Box; text: string; value: number }) => {
    const stacked = fitsTwoLines({ box });
    const amount = stacked ? compactAmount(value) : '';
    const center = { x: x + HUB_WIDTH / 2, y: (box.y0 + box.y1) / 2 };
    const pillWidth =
      Math.max(textWidth({ text, font: nameFont }), textWidth({ text: amount, font: detailFont })) + PILL_PADDING * 2;
    const pillHeight = (stacked ? DETAIL_ROW_HEIGHT : LABEL_ROW_HEIGHT) + PILL_EXTRA_HEIGHT;
    // These labels straddle a saturated bar, where an outline alone leaves the text unreadable.
    labels
      .append('rect')
      .attr('x', center.x - pillWidth / 2)
      .attr('y', center.y - pillHeight / 2)
      .attr('width', pillWidth)
      .attr('height', pillHeight)
      .attr('rx', PILL_RADIUS)
      .attr('fill', colors.card)
      .attr('fill-opacity', PILL_OPACITY)
      .attr('pointer-events', 'none');
    haloLabel({
      x: center.x,
      y: center.y + (stacked ? CENTERED_STACKED_BASELINE_OFFSET : CENTERED_BASELINE_OFFSET),
      anchor: 'middle',
      text,
      amount,
      stacked,
    });
  };

  const drawSideLabels = ({ items, x, halo = false }: { items: LabelRow[]; x: number; halo?: boolean }) => {
    const tops = spreadTops({
      boxes: items.map((row) => row.box),
      heights: items.map((row) => (row.detailed ? DETAIL_ROW_HEIGHT : LABEL_ROW_HEIGHT)),
      limit: height,
    });
    items.forEach((row, i) => {
      const top = tops[i]!;
      const group = bindHighlight({
        selection: bindTooltip({ selection: labels.append('g'), content: row.content }),
        key: row.key,
      });
      if (halo) group.attr('paint-order', 'stroke').attr('stroke', colors.card).attr('stroke-width', 3);
      const name = group
        .append('text')
        .attr('x', x)
        .attr('y', top + NAME_BASELINE_OFFSET)
        .attr('fill', colors.foreground)
        .attr('font-weight', 600)
        .text(row.name);
      const detail = row.detailed
        ? group
            .append('text')
            .attr('x', x)
            .attr('y', top + NAME_BASELINE_OFFSET + DETAIL_LINE_OFFSET)
        : name.append('tspan');
      detail.attr('font-size', DETAIL_FONT_SIZE).attr('font-weight', 400);
      detail
        .append('tspan')
        .attr('fill', colors.foreground)
        .text(`${row.detailed ? '' : ' '}${row.amount}`);
      detail.append('tspan').attr('fill', colors.text).text(` ${row.share}`);
    });
  };

  let hubInput = 0;
  leftRows.forEach(({ node, box, key, content }) => {
    const target = { y0: hubInput, y1: hubInput + node.value * scale };
    hubInput = target.y1;
    const color = nodeColor({ node, colors, fallback: colors.appIncome });
    drawLink({
      d: ribbon({ x0: NODE_WIDTH, x1: xHub, a: box, b: target }),
      color,
      opacity: 0.2,
      ends: [key, 'hub'],
      names: [nodeLabel({ node, t }), hubLabel],
      value: node.value,
    });
    drawNode({ x: 0, box, w: NODE_WIDTH, color, content, key });
  });
  drawSideLabels({ x: xInside, items: leftRows, halo: true });

  drawNode({ x: xHub, box: hubBox, w: HUB_WIDTH, color: colors.appIncome, content: hubTooltip, key: 'hub' });

  let hubOutput = 0;
  outflows.forEach((node, i) => {
    const box = midBoxes[i]!;
    const source = { y0: hubOutput, y1: hubOutput + node.value * scale };
    hubOutput = source.y1;
    const key = `mid:${node.id}`;
    drawLink({
      d: ribbon({ x0: xHub + HUB_WIDTH, x1: xMid, a: source, b: box }),
      color: node.color,
      opacity: 0.2,
      ends: ['hub', key],
      names: [hubLabel, node.name],
      value: node.value,
    });
    drawNode({ x: xMid, box, w: HUB_WIDTH, color: node.color, content: midTooltip(node), key });
  });

  const drawOutflows = ({
    leaves,
    from,
    parentKey,
    parentName,
    x0,
    ribbonColor,
  }: {
    leaves: typeof rightLeaves;
    from: Box;
    parentKey: string;
    parentName: string;
    x0: number;
    ribbonColor: string;
  }) => {
    let output = from.y0;
    leaves.forEach(({ node, box, key, color, content }) => {
      const source = { y0: output, y1: output + node.value * scale };
      output = source.y1;
      drawLink({
        d: ribbon({ x0, x1: xRight, a: source, b: box }),
        color: ribbonColor,
        opacity: 0.14,
        ends: [parentKey, key],
        names: [parentName, nodeLabel({ node, t })],
        value: node.value,
      });
      drawNode({ x: xRight, box, w: NODE_WIDTH, color, content, key });
    });
  };

  // Each root category sits centered on its leaves, so the group column never overlaps itself.
  const drawGroups = ({ from }: { from: Box }) => {
    let output = from.y0;
    const groupBoxes = flow.expenseGroups.map((group) => {
      const key = `group:${group.id}`;
      const leaves = leavesOf({ parentKey: key });
      const groupHeight = group.value * scale;
      const y0 = (leaves[0]!.box.y0 + leaves.at(-1)!.box.y1 - groupHeight) / 2;
      const box = { y0, y1: y0 + groupHeight };
      const source = { y0: output, y1: output + groupHeight };
      output = source.y1;
      const color = nodeColor({ node: group, colors, fallback: colors.appExpense });
      drawLink({
        d: ribbon({ x0: xMid + HUB_WIDTH, x1: xGroup, a: source, b: box }),
        color: colors.appExpense,
        opacity: 0.14,
        ends: ['mid:expenses', key],
        names: [t('analytics.cashFlow.expenses'), nodeLabel({ node: group, t })],
        value: group.value,
      });
      drawNode({
        x: xGroup,
        box,
        w: NODE_WIDTH,
        color,
        content: categoryTooltip({ node: group, color, shareLabel: shareOfExpenses }),
        key,
      });
      drawOutflows({
        leaves,
        from: box,
        parentKey: key,
        parentName: nodeLabel({ node: group, t }),
        x0: xGroup + NODE_WIDTH,
        ribbonColor: color,
      });
      return box;
    });

    const labelMax = xGroup - (xMid + HUB_WIDTH) - GROUP_LABEL_GAP * 2;
    const stacked = groupBoxes.map((box) => fitsTwoLines({ box }));
    const tops = spreadTops({
      boxes: groupBoxes,
      heights: stacked.map((s) => (s ? DETAIL_ROW_HEIGHT : LABEL_ROW_HEIGHT)),
      limit: height,
    });
    flow.expenseGroups.forEach((group, i) => {
      const text = nodeLabel({ node: group, t });
      const amount = compactAmount(group.value);
      const inlineWidth = textWidth({ text, font: nameFont }) + textWidth({ text: ` ${amount}`, font: detailFont });
      haloLabel({
        x: xGroup - GROUP_LABEL_GAP,
        y: tops[i]! + NAME_BASELINE_OFFSET,
        anchor: 'end',
        text: fitText({ text, font: nameFont, max: labelMax }),
        amount: stacked[i] || inlineWidth <= labelMax ? amount : '',
        stacked: stacked[i],
      });
    });
  };

  outflows.forEach((outflow, i) => {
    if (grouped && outflow.id === 'expenses') {
      drawGroups({ from: midBoxes[i]! });
      return;
    }
    const parentKey = `mid:${outflow.id}`;
    drawOutflows({
      leaves: leavesOf({ parentKey }),
      from: midBoxes[i]!,
      parentKey,
      parentName: outflow.name,
      x0: xMid + HUB_WIDTH,
      ribbonColor: outflow.color,
    });
  });
  drawSideLabels({ x: xRight + NODE_WIDTH + LABEL_OFFSET, items: rightRows });

  columnLabel({ x: xHub, box: hubBox, text: hubLabel, value: hub });
  outflows.forEach((node, i) => {
    const box = midBoxes[i]!;
    if (!isTerminal({ outflow: node })) {
      columnLabel({ x: xMid, box, text: node.name, value: node.value });
      return;
    }
    const label = labels
      .append('text')
      .attr('x', xMid + HUB_WIDTH + LABEL_OFFSET)
      .attr('y', Math.max(LABEL_FONT_SIZE, (box.y0 + box.y1) / 2 + CENTERED_BASELINE_OFFSET))
      .attr('fill', colors.foreground)
      .attr('font-weight', 600)
      .attr('pointer-events', 'none')
      .text(node.name);
    const detail = label.append('tspan').attr('font-size', DETAIL_FONT_SIZE).attr('font-weight', 400);
    detail.append('tspan').text(` ${compactAmount(node.value)}`);
    if (flow.income > 0) {
      detail
        .append('tspan')
        .attr('fill', colors.text)
        .text(` (${formatShare(node.value / flow.income)})`);
    }
  });
};

useResizeObserver(containerRef, renderChart);
watch([() => props.flow, locale, currentTheme, baseCurrency], renderChart, { deep: true });
</script>

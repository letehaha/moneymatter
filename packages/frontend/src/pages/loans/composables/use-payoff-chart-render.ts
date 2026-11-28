import { getChartColors } from '@/composable/charts/chart-colors';
import * as d3 from 'd3';
import { addMonths } from 'date-fns';
import { type ComputedRef, type Ref } from 'vue';

import { type PayoffPoint, type PayoffScenario } from '../utils/payoff-schedule';

// Forward-projection scenarios (`minimum`/`planned`/`custom`) plus the two
// retrospective lines the paid-off "balance journey" chart feeds in.
type ScenarioKey = 'minimum' | 'planned' | 'custom' | 'actual' | 'schedule';

/** Minimal shape `render` reads off each renderable scenario line. */
interface RenderableLine {
  key: ScenarioKey;
  dashed: boolean;
  scenario: PayoffScenario | null;
  /** Marker label date — planned scenario uses the backend projection's date so the chart never
   * disagrees with the Projection card. Curve/marker position still come from the local schedule. */
  displayPayoffDate?: Date;
}

/** The reactive tooltip object the chart mutates as the pointer moves. */
interface PayoffChartTooltip {
  visible: boolean;
  x: number;
  y: number;
  dateLabel: string;
  entries: Array<{ key: ScenarioKey; color: string; label: string; value: number; paidOff: boolean }>;
}

interface UsePayoffChartRenderOptions {
  svgRef: Ref<SVGSVGElement | null>;
  containerRef: Ref<HTMLDivElement | null>;
  /** Scenarios that pay off and have enough points to draw, in stacking order. */
  renderableLines: ComputedRef<RenderableLine[]>;
  /** Reference "now" anchoring the x-axis domain and the hover snap. */
  today: Date;
  /** Reactive tooltip state mutated on hover/touch. */
  tooltip: PayoffChartTooltip;
  /** Positions the tooltip element within the viewport. */
  updateTooltipPosition: (event: MouseEvent | { clientX: number; clientY: number }) => void;
  /** Formats a y-axis tick value (already currency-aware). */
  formatAxisValue: (value: number) => string;
  /** Locale-aware date formatter for payoff markers and the tooltip header. */
  formatDate: (date: Date, formatStr: string) => string;
  /** i18n translator for the per-scenario legend/tooltip labels. */
  t: (key: string) => string;
}

const MOBILE_CHART_BREAKPOINT_PX = 400;
const MIN_YEAR_LABEL_SPACING_PX = 48;
// Approximation used ONLY to index into the per-month points array for hover snapping — never feeds
// a displayed date or money math, so do not "fix" it into date-fns.
const APPROX_MONTH_MS_FOR_HOVER_SNAP = 1000 * 60 * 60 * 24 * 30.4375;

const SCENARIO_STROKE: Record<ScenarioKey, (colors: ReturnType<typeof getChartColors>) => string> = {
  minimum: (c) => c.text,
  planned: (c) => c.primary,
  custom: (c) => c.appIncome,
  // Retrospective lines: the loan's real balance history (green) vs. its original schedule (muted).
  actual: (c) => c.appIncome,
  schedule: (c) => c.text,
};

/**
 * Hand-rolled D3 renderer for the multi-line loan-payoff chart; everything it closes over is passed
 * in via options so it stays a pure structural extraction from the component.
 */
export function usePayoffChartRender({
  svgRef,
  containerRef,
  renderableLines,
  today,
  tooltip,
  updateTooltipPosition,
  formatAxisValue,
  formatDate,
  t,
}: UsePayoffChartRenderOptions) {
  const render = () => {
    if (!svgRef.value || !containerRef.value) return;

    const svg = d3.select(svgRef.value);
    svg.selectAll('*').remove();

    const lines = renderableLines.value;
    if (lines.length === 0) return;

    const colors = getChartColors();
    const width = containerRef.value.clientWidth;
    const height = containerRef.value.clientHeight;
    if (width === 0 || height === 0) return;

    const isMobile = width < MOBILE_CHART_BREAKPOINT_PX;
    const margin = { top: 12, right: isMobile ? 14 : 24, left: isMobile ? 52 : 64, bottom: 28 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const fontSize = isMobile ? '10px' : '11px';

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const latestPayoff = lines.reduce(
      (max, d) => ((d.scenario!.payoffDate as Date) > max ? (d.scenario!.payoffDate as Date) : max),
      lines[0]!.scenario!.payoffDate as Date,
    );
    // A payoff landing on `today` (loan opened and settled the same day) would collapse the time
    // domain to a single instant and turn every x position into NaN — pad the end to one month.
    const domainEnd = latestPayoff > today ? latestPayoff : addMonths(today, 1);
    const xScale = d3.scaleTime().domain([today, domainEnd]).range([0, innerWidth]);

    // No `.nice()`/headroom multiplier: pin the axis top to the actual starting balance so the curve
    // starts at the very top of the plot instead of leaving an empty gap below the header.
    const startBalance = d3.max(lines, (d) => d.scenario!.points[0]!.balance) ?? 1;
    const yScale = d3.scaleLinear().domain([0, startBalance]).range([innerHeight, 0]);

    // Horizontal grid
    g.append('g')
      .call(
        d3
          .axisLeft(yScale)
          .ticks(isMobile ? 4 : 5)
          .tickSize(-innerWidth)
          .tickFormat(() => ''),
      )
      .call((grid) => {
        grid.select('.domain').remove();
        grid.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.45);
      });

    // Y axis
    g.append('g')
      .call(
        d3
          .axisLeft(yScale)
          .ticks(isMobile ? 4 : 5)
          .tickFormat((d) => formatAxisValue(d as number)),
      )
      .call((axis) => {
        axis.select('.domain').remove();
        axis.selectAll('.tick line').remove();
        axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', fontSize);
      });

    // X axis (years)
    const yearSpan = domainEnd.getFullYear() - today.getFullYear();
    const maxYearLabels = Math.max(1, Math.floor(innerWidth / MIN_YEAR_LABEL_SPACING_PX));
    const yearStep = Math.max(isMobile ? 2 : 1, Math.ceil(yearSpan / maxYearLabels));
    const yearTicks = xScale.ticks(d3.timeYear.every(yearStep) ?? d3.timeYear);
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .tickValues(yearTicks)
          .tickFormat((d) => d3.timeFormat('%Y')(d as Date)),
      )
      .call((axis) => {
        axis.select('.domain').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
        axis.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
        axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', fontSize);
      });

    const lineGen = d3
      .line<PayoffPoint>()
      .x((p) => xScale(p.date))
      .y((p) => yScale(p.balance))
      .curve(d3.curveMonotoneX);

    for (const d of lines) {
      const stroke = SCENARIO_STROKE[d.key](colors);
      g.append('path')
        .datum(d.scenario!.points)
        .attr('fill', 'none')
        .attr('stroke', stroke)
        .attr('stroke-width', d.key === 'custom' ? 2.75 : 2)
        .attr('stroke-dasharray', d.dashed ? '6,4' : null)
        .attr('d', lineGen);
    }

    // Payoff markers — a dot where each line reaches zero, annotated with the date.
    lines.forEach((d, i) => {
      const stroke = SCENARIO_STROKE[d.key](colors);
      const px = xScale(d.scenario!.payoffDate as Date);
      const py = yScale(0);
      g.append('circle')
        .attr('cx', px)
        .attr('cy', py)
        .attr('r', 4)
        .attr('fill', stroke)
        .attr('stroke', colors.card)
        .attr('stroke-width', 1.5);
      g.append('text')
        .attr('x', px)
        .attr('y', py - 8 - i * 13)
        .attr('text-anchor', px > innerWidth - 36 ? 'end' : 'middle')
        .attr('fill', stroke)
        .attr('font-size', '10px')
        .attr('font-weight', '600')
        .text(formatDate(d.displayPayoffDate ?? (d.scenario!.payoffDate as Date), "MMM ''yy"));
    });

    // Hover interaction
    const hoverLine = g
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', colors.text)
      .attr('stroke-opacity', 0.4)
      .attr('stroke-dasharray', '3,3')
      .style('display', 'none')
      .style('pointer-events', 'none');

    const hoverDots = lines.map((d) =>
      g
        .append('circle')
        .attr('r', 4.5)
        .attr('fill', SCENARIO_STROKE[d.key](colors))
        .attr('stroke', colors.card)
        .attr('stroke-width', 2)
        .style('display', 'none')
        .style('pointer-events', 'none'),
    );

    const showAt = ({ clientX, clientY, mouseX }: { clientX: number; clientY: number; mouseX: number }) => {
      const dateAtMouse = xScale.invert(mouseX);
      const monthsFromToday = Math.max(
        0,
        Math.round((dateAtMouse.getTime() - today.getTime()) / APPROX_MONTH_MS_FOR_HOVER_SNAP),
      );
      const snappedDate =
        lines[0]!.scenario!.points[Math.min(monthsFromToday, lines[0]!.scenario!.points.length - 1)]!.date;

      tooltip.entries = lines.map((d, i) => {
        const points = d.scenario!.points;
        const point = points[Math.min(monthsFromToday, points.length - 1)]!;
        const paidOff = monthsFromToday >= points.length - 1;
        hoverDots[i]!.style('display', null).attr('cx', xScale(point.date)).attr('cy', yScale(point.balance));
        return {
          key: d.key,
          color: SCENARIO_STROKE[d.key](colors),
          label: t(`loans.detail.payoffChart.legend.${d.key}`),
          value: point.balance,
          paidOff,
        };
      });
      tooltip.dateLabel = formatDate(snappedDate, 'MMM yyyy');
      tooltip.visible = true;

      hoverLine.style('display', null).attr('x1', xScale(snappedDate)).attr('x2', xScale(snappedDate));
      updateTooltipPosition({ clientX, clientY });
    };

    const hide = () => {
      tooltip.visible = false;
      hoverLine.style('display', 'none');
      hoverDots.forEach((dot) => dot.style('display', 'none'));
    };

    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event);
        showAt({ clientX: event.clientX, clientY: event.clientY, mouseX: mx });
      })
      .on('mouseleave', hide)
      .on('touchstart touchmove', (event: TouchEvent) => {
        const touch = event.touches[0];
        if (!touch) return;
        event.preventDefault();
        const [tx] = d3.pointer(touch, svgRef.value!);
        showAt({ clientX: touch.clientX, clientY: touch.clientY, mouseX: tx - margin.left });
      })
      .on('touchend', hide);
  };

  return { render };
}
